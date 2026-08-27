#import "wrapper.h"
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <thread>
#include <mutex>

// Objective-C delegate to handle audio samples
// NOTE: Manual reference counting (MRC) required for macOS 26.2+ ARC bug workaround (FB21107737)
@interface AudioCaptureDelegate : NSObject <SCStreamOutput, SCStreamDelegate> {
    void(^_audioCallback)(CMSampleBufferRef);
}
@property (nonatomic, copy) void(^audioCallback)(CMSampleBufferRef);
@end

@implementation AudioCaptureDelegate

@synthesize audioCallback = _audioCallback;

- (void)setAudioCallback:(void(^)(CMSampleBufferRef))audioCallback {
    if (_audioCallback != audioCallback) {
        [_audioCallback release];
        _audioCallback = [audioCallback copy];
    }
}

- (void)dealloc {
    [_audioCallback release];
    [super dealloc];
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    // Only process audio samples - this is an audio-only capture pipeline.
    if (type == SCStreamOutputTypeAudio && _audioCallback) {
        _audioCallback(sampleBuffer);
    }
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    if (error) {
        NSLog(@"Stream stopped with error: %@", error.localizedDescription);
    }
}

@end

// Implementation class
// NOTE: Manual reference counting (MRC) required for macOS 26.2+ ARC bug workaround (FB21107737)
@interface ScreenCaptureKitImpl : NSObject {
    SCStream *_stream;
    AudioCaptureDelegate *_delegate;
    SCContentFilter *_contentFilter;
    BOOL _isCapturing;
}
@property (nonatomic, retain) SCStream *stream;
@property (nonatomic, retain) AudioCaptureDelegate *delegate;
@property (nonatomic, retain) SCContentFilter *contentFilter;
@property (nonatomic, assign) BOOL isCapturing;
@end

@implementation ScreenCaptureKitImpl

@synthesize stream = _stream;
@synthesize delegate = _delegate;
@synthesize contentFilter = _contentFilter;
@synthesize isCapturing = _isCapturing;

- (instancetype)init {
    self = [super init];
    if (self) {
        _isCapturing = NO;
        _stream = nil;
        _delegate = nil;
        _contentFilter = nil;
    }
    return self;
}

- (void)dealloc {
    [self stopCapture];
    [_stream release];
    [_delegate release];
    [_contentFilter release];
    [super dealloc];
}

- (void)setStream:(SCStream *)stream {
    if (_stream != stream) {
        [_stream release];
        _stream = [stream retain];
    }
}

- (void)setDelegate:(AudioCaptureDelegate *)delegate {
    if (_delegate != delegate) {
        [_delegate release];
        _delegate = [delegate retain];
    }
}

- (void)setContentFilter:(SCContentFilter *)contentFilter {
    if (_contentFilter != contentFilter) {
        [_contentFilter release];
        _contentFilter = [contentFilter retain];
    }
}

- (void)stopCapture {
    if (_stream && _isCapturing) {
        [_stream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
            if (error) {
                NSLog(@"Error stopping capture: %@", error.localizedDescription);
            }
        }];
        _isCapturing = NO;
        [_stream release];
        _stream = nil;
        [_delegate release];
        _delegate = nil;
        [_contentFilter release];
        _contentFilter = nil;
    }
}

@end

// Objective-C implementation for microphone capture. Uses an AVAudioEngine
// input tap to read raw float samples from the default input device.
@interface MicrophoneCaptureImpl : NSObject {
    AVAudioEngine *_engine;
    BOOL _isCapturing;
}
@property (nonatomic, retain) AVAudioEngine *engine;
@property (nonatomic, assign) BOOL isCapturing;
@end

@implementation MicrophoneCaptureImpl

@synthesize engine = _engine;
@synthesize isCapturing = _isCapturing;

- (instancetype)init {
    self = [super init];
    if (self) {
        _isCapturing = NO;
        _engine = nil;
    }
    return self;
}

- (void)dealloc {
    [self stopCapture];
    [_engine release];
    [super dealloc];
}

- (void)setEngine:(AVAudioEngine *)engine {
    if (_engine != engine) {
        [_engine release];
        _engine = [engine retain];
    }
}

- (void)stopCapture {
    if (_engine && _isCapturing) {
        [_engine stop];
        [_engine.inputNode removeTapOnBus:0];
        _isCapturing = NO;
    }
}

@end

namespace screencapturekit {

// Private implementation structure
struct WrapperImpl {
    ScreenCaptureKitImpl *objcImpl;
    std::function<void(const AudioSample&)> callback;
    std::mutex mutex;
};

namespace {

// Helper to run the main run loop until a condition is met or timeout
// This is required on macOS 26+ where SCKit dispatches completion handlers to main queue
void RunLoopUntilComplete(bool *completed, double timeoutSeconds) {
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + timeoutSeconds;
    while (!*completed && CFAbsoluteTimeGetCurrent() < deadline) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, true);
    }
}

void HandleSampleBuffer(CMSampleBufferRef sampleBuffer, WrapperImpl *wrapper) {
    if (!wrapper || !wrapper->callback) {
        return;
    }

    @try {
        // Get format description first
        CMFormatDescriptionRef formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (!formatDescription) {
            NSLog(@"No format description available");
            return;
        }

        const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription);
        if (!asbd) {
            NSLog(@"No audio stream basic description available");
            return;
        }

        AudioSample sample;
        sample.sampleRate = (int)asbd->mSampleRate;
        sample.channelCount = (int)asbd->mChannelsPerFrame;
        sample.timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer));

        UInt32 expectedBuffers = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved)
            ? asbd->mChannelsPerFrame
            : 1;

        if (expectedBuffers > 16) {
            expectedBuffers = 16;
        }

        size_t audioBufferListSize = offsetof(AudioBufferList, mBuffers[0]) + (sizeof(AudioBuffer) * expectedBuffers);
        AudioBufferList *audioBufferList = (AudioBufferList *)malloc(audioBufferListSize);
        if (!audioBufferList) {
            NSLog(@"Failed to allocate AudioBufferList for %u buffers", (unsigned int)expectedBuffers);
            return;
        }

        CMBlockBufferRef blockBuffer = NULL;
        OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            NULL,
            audioBufferList,
            audioBufferListSize,
            NULL,
            NULL,
            0,
            &blockBuffer
        );

        if (status != noErr) {
            NSLog(@"Failed to get audio buffer list: %d", (int)status);
            free(audioBufferList);
            return;
        }

        if (audioBufferList->mNumberBuffers > expectedBuffers) {
            NSLog(@"Warning: AudioBufferList has %u buffers but we allocated for %u. Data may be truncated.",
                  (unsigned int)audioBufferList->mNumberBuffers, (unsigned int)expectedBuffers);
        }

        bool isPlanar = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
        bool isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
        bool isInt = (asbd->mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0;

        if (isPlanar) {
            if (audioBufferList->mNumberBuffers == 0) {
                free(audioBufferList);
                if (blockBuffer) CFRelease(blockBuffer);
                return;
            }

            size_t framesPerBuffer = 0;
            if (isFloat) {
                framesPerBuffer = audioBufferList->mBuffers[0].mDataByteSize / sizeof(float);
            } else if (isInt) {
                framesPerBuffer = audioBufferList->mBuffers[0].mDataByteSize / sizeof(int16_t);
            }

            for (size_t frame = 0; frame < framesPerBuffer; frame++) {
                for (UInt32 channel = 0; channel < audioBufferList->mNumberBuffers && channel < expectedBuffers; channel++) {
                    AudioBuffer audioBuffer = audioBufferList->mBuffers[channel];
                    if (!audioBuffer.mData) continue;

                    if (isFloat) {
                        float *bufferData = (float *)audioBuffer.mData;
                        sample.data.push_back(bufferData[frame]);
                    } else if (isInt) {
                        int16_t *bufferData = (int16_t *)audioBuffer.mData;
                        float normalized = bufferData[frame] / 32768.0f;
                        sample.data.push_back(normalized);
                    }
                }
            }
        } else {
            for (UInt32 i = 0; i < audioBufferList->mNumberBuffers && i < expectedBuffers; i++) {
                AudioBuffer audioBuffer = audioBufferList->mBuffers[i];

                if (!audioBuffer.mData || audioBuffer.mDataByteSize == 0) {
                    continue;
                }

                if (isFloat) {
                    float *bufferData = (float *)audioBuffer.mData;
                    size_t bufferSize = audioBuffer.mDataByteSize / sizeof(float);
                    sample.data.insert(sample.data.end(), bufferData, bufferData + bufferSize);
                } else if (isInt) {
                    int16_t *bufferData = (int16_t *)audioBuffer.mData;
                    size_t bufferSize = audioBuffer.mDataByteSize / sizeof(int16_t);
                    for (size_t j = 0; j < bufferSize; j++) {
                        float normalized = bufferData[j] / 32768.0f;
                        sample.data.push_back(normalized);
                    }
                }
            }
        }

        free(audioBufferList);
        if (blockBuffer) {
            CFRelease(blockBuffer);
        }

        if (sample.data.size() > 0) {
            wrapper->callback(sample);
        }
    } @catch (NSException *exception) {
        NSLog(@"Exception in audio callback: %@", exception);
    }
}

bool StartStreamWithFilter(WrapperImpl *wrapper, SCContentFilter *filter, const CaptureConfig& config) {
    if (!wrapper || !filter) {
        return false;
    }

    wrapper->objcImpl.contentFilter = filter;
    [filter release]; // Transfer ownership to contentFilter property

    SCStreamConfiguration *streamConfig = [[SCStreamConfiguration alloc] init];
    
    // Audio configuration
    streamConfig.capturesAudio = YES;
    streamConfig.sampleRate = config.sampleRate;
    streamConfig.channelCount = config.channels;
    streamConfig.excludesCurrentProcessAudio = YES;
    
    // ScreenCaptureKit requires a video configuration even for audio-only capture.
    // We minimize it to the smallest valid dimensions and slowest frame rate so
    // that no meaningful video is produced while still allowing audio capture.
    streamConfig.width = 2;
    streamConfig.height = 2;
    streamConfig.minimumFrameInterval = CMTimeMake(10, 1); // 1 frame per 10 seconds
    streamConfig.showsCursor = NO;
    streamConfig.queueDepth = 1;
    streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange; // Minimal color format
    streamConfig.scalesToFit = YES; // Scale down to 2x2

    AudioCaptureDelegate *delegate = [[AudioCaptureDelegate alloc] init];
    delegate.audioCallback = ^(CMSampleBufferRef sampleBuffer) {
        HandleSampleBuffer(sampleBuffer, wrapper);
    };
    wrapper->objcImpl.delegate = delegate;
    [delegate release]; // Transfer ownership to delegate property

    NSError *streamError = nil;
    SCStream *stream = [[SCStream alloc] initWithFilter:wrapper->objcImpl.contentFilter configuration:streamConfig delegate:wrapper->objcImpl.delegate];
    [streamConfig release];

    if (!stream) {
        NSLog(@"Failed to create stream");
        wrapper->objcImpl.contentFilter = nil;
        wrapper->objcImpl.delegate = nil;
        return false;
    }
    [stream autorelease]; // Will be retained by stream property
    
    // Store stream reference BEFORE starting capture (important for macOS 26+)
    wrapper->objcImpl.stream = stream;

    // Add audio output handler on high priority queue for low latency
    [stream addStreamOutput:wrapper->objcImpl.delegate
                       type:SCStreamOutputTypeAudio
         sampleHandlerQueue:dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0)
                     error:&streamError];

    if (streamError) {
        NSLog(@"Error adding audio stream output: %@", streamError.localizedDescription);
        wrapper->objcImpl.stream = nil;
        wrapper->objcImpl.contentFilter = nil;
        wrapper->objcImpl.delegate = nil;
        return false;
    }

    // Start capture - caller is responsible for pumping the run loop
    // This is called from main queue context on macOS 26+
    __block bool success = false;
    __block bool startCompleted = false;

    [stream startCaptureWithCompletionHandler:^(NSError * _Nullable error) {
        if (error) {
            NSLog(@"Error starting capture: %@", error.localizedDescription);
            wrapper->objcImpl.isCapturing = NO;
            wrapper->objcImpl.stream = nil;
            wrapper->objcImpl.delegate = nil;
            wrapper->objcImpl.contentFilter = nil;
            success = false;
        } else {
            wrapper->objcImpl.isCapturing = YES;
            success = true;
        }
        startCompleted = true;
    }];

    // Pump run loop to allow completion handler delivery
    RunLoopUntilComplete(&startCompleted, 10.0);

    if (!startCompleted) {
        NSLog(@"Timeout waiting for capture to start (10s).");
        wrapper->objcImpl.isCapturing = NO;
        wrapper->objcImpl.stream = nil;
        wrapper->objcImpl.delegate = nil;
        wrapper->objcImpl.contentFilter = nil;
        return false;
    }

    return success;
}

// Static flag to ensure CoreGraphics is initialized once
static bool cgsInitialized = false;
static std::mutex cgsInitMutex;

// Initialize CoreGraphics connection to window server
// This must be called before any window/display enumeration
void EnsureCGSInitialized() {
    std::lock_guard<std::mutex> lock(cgsInitMutex);
    if (cgsInitialized) return;
    
    // Force window server connection by calling CGMainDisplayID
    // Use dispatch_async + run loop pumping to avoid deadlock with main queue
    if ([NSThread isMainThread]) {
        CGMainDisplayID();
        cgsInitialized = true;
    } else {
        __block bool completed = false;
        dispatch_async(dispatch_get_main_queue(), ^{
            CGMainDisplayID();
            completed = true;
        });
        // Pump run loop to allow the async block to execute
        RunLoopUntilComplete(&completed, 5.0);
        if (completed) {
            cgsInitialized = true;
        }
    }
}

} // namespace

ScreenCaptureKitWrapper::ScreenCaptureKitWrapper() {
    // Ensure CoreGraphics is initialized before any operations
    EnsureCGSInitialized();
    
    WrapperImpl *wrapper = new WrapperImpl();
    wrapper->objcImpl = [[ScreenCaptureKitImpl alloc] init];
    impl = wrapper;
}

ScreenCaptureKitWrapper::~ScreenCaptureKitWrapper() {
    if (impl) {
        WrapperImpl *wrapper = static_cast<WrapperImpl*>(impl);
        [wrapper->objcImpl stopCapture];
        [wrapper->objcImpl release];
        delete wrapper;
        impl = nullptr;
    }
}

std::vector<AppInfo> ScreenCaptureKitWrapper::getAvailableApps() {
    __block std::vector<AppInfo> apps;
    __block bool completed = false;

    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
        if (error) {
            NSLog(@"Error getting shareable content: %@", error.localizedDescription);
        } else if (content) {
            for (SCRunningApplication *app in content.applications) {
                if (app.applicationName && app.bundleIdentifier) {
                    AppInfo info;
                    info.processId = app.processID;
                    info.bundleIdentifier = std::string([app.bundleIdentifier UTF8String]);
                    info.applicationName = std::string([app.applicationName UTF8String]);
                    apps.push_back(info);
                }
            }
        }
        completed = true;
    }];

    RunLoopUntilComplete(&completed, 10.0);

    return apps;
}

bool ScreenCaptureKitWrapper::startCapture(int processId, const CaptureConfig& config, std::function<void(const AudioSample&)> callback) {
    if (!impl) return false;

    WrapperImpl *wrapper = static_cast<WrapperImpl*>(impl);
    std::lock_guard<std::mutex> lock(wrapper->mutex);

    if (wrapper->objcImpl.isCapturing) {
        return false; // Already capturing
    }

    wrapper->callback = callback;
    __block bool success = false;
    __block bool completed = false;
    __block SCShareableContent *capturedContent = nil;

    // macOS 26+ dispatches SCKit completion handlers to main queue.
    // Call directly and pump run loop to process completions.
    //
    // Include off-screen windows so that apps running in the background
    // (no visible/on-screen window) can still be captured for audio.
    // The default getShareableContentWithCompletionHandler: only returns
    // on-screen windows, which causes "Failed to find any displays or
    // windows to capture" for background apps.
    void (^fetchContent)(void) = ^{
        if (@available(macOS 14.0, *)) {
            [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                       onScreenWindowsOnly:NO
                                                         completionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
                if (error || !content) {
                    NSLog(@"Error getting shareable content: %@", error.localizedDescription);
                    completed = true;
                    return;
                }
                // Retain content to avoid macOS 26.2 ARC bug (FB21107737)
                capturedContent = [content retain];
                completed = true;
            }];
        } else {
            [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
                if (error || !content) {
                    NSLog(@"Error getting shareable content: %@", error.localizedDescription);
                    completed = true;
                    return;
                }
                // Retain content to avoid macOS 26.2 ARC bug (FB21107737)
                capturedContent = [content retain];
                completed = true;
            }];
        }
    };
    fetchContent();

    RunLoopUntilComplete(&completed, 10.0);
    
    if (!capturedContent) {
        return false;
    }

    // Find the application with matching process ID
    SCRunningApplication *targetApp = nil;
    for (SCRunningApplication *app in capturedContent.applications) {
        if (app.processID == processId) {
            targetApp = app;
            break;
        }
    }

    if (!targetApp) {
        NSLog(@"Could not find application with process ID: %d", processId);
        [capturedContent release];
        return false;
    }

    SCContentFilter *filter = nil;
    
    // Prefer window-based capture when the app has an on-screen window - this
    // allows concurrent captures from different processes. Per Apple WWDC:
    // "When a single window filter is used, all the audio content from the
    // application that contains the window will be captured".
    //
    // For background apps (no on-screen window), fall back to display-based
    // capture with `includingApplications:@[targetApp]`, which reliably
    // captures all audio from that single app regardless of window state.
    SCWindow *targetWindow = nil;
    for (SCWindow *window in capturedContent.windows) {
        if (window.owningApplication && window.owningApplication.processID == processId && window.isOnScreen) {
            targetWindow = window;
            break;
        }
    }
    
    if (targetWindow) {
        // Use window-based capture - captures all audio from the owning app
        filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWindow];
        NSLog(@"Using window-based capture for process %d (window ID: %u)", processId, (unsigned int)targetWindow.windowID);
    } else if (capturedContent.displays.count > 0) {
        // Display-based capture including only the target app - works for
        // background apps that have no on-screen window.
        NSLog(@"No on-screen window for process %d, using display-based capture for that app only", processId);
        filter = [[SCContentFilter alloc] initWithDisplay:capturedContent.displays.firstObject
                                     includingApplications:@[targetApp]
                                        exceptingWindows:@[]];
    } else {
        NSLog(@"No displays or windows available for capture");
        [capturedContent release];
        return false;
    }

    success = StartStreamWithFilter(wrapper, filter, config);
    [capturedContent release];
    return success;
}

void ScreenCaptureKitWrapper::stopCapture() {
    if (!impl) return;

    WrapperImpl *wrapper = static_cast<WrapperImpl*>(impl);
    std::lock_guard<std::mutex> lock(wrapper->mutex);

    [wrapper->objcImpl stopCapture];
    wrapper->callback = nullptr;
}

bool ScreenCaptureKitWrapper::isCapturing() const {
    if (!impl) return false;

    WrapperImpl *wrapper = static_cast<WrapperImpl*>(impl);
    return wrapper->objcImpl.isCapturing;
}

// ---------------------------------------------------------------------------
// Microphone capture via AVAudioEngine
// ---------------------------------------------------------------------------

// Private implementation structure for microphone capture
struct MicWrapperImpl {
    MicrophoneCaptureImpl *objcImpl;
    std::function<void(const AudioSample&)> callback;
    std::mutex mutex;
};

namespace {

// Convert an AVAudioPCMBuffer (float32) into an AudioSample. The buffer is
// already non-interleaved float32; we interleave channels into sample.data.
void HandleMicBuffer(AVAudioPCMBuffer *buffer, MicWrapperImpl *wrapper) {
    if (!wrapper || !wrapper->callback || !buffer) {
        return;
    }

    AVAudioFormat *format = buffer.format;
    if (!format) {
        return;
    }

    AudioSample sample;
    sample.sampleRate = (int)format.sampleRate;
    sample.channelCount = (int)format.channelCount;
    sample.timestamp = CACurrentMediaTime();

    AVAudioChannelCount channelCount = format.channelCount;
    AVAudioFrameCount frameCount = buffer.frameLength;

    if (channelCount == 0 || frameCount == 0) {
        return;
    }

    // Interleave planar float32 channels into a single sample.data vector.
    for (AVAudioFrameCount frame = 0; frame < frameCount; frame++) {
        for (AVAudioChannelCount channel = 0; channel < channelCount; channel++) {
            const float *channelData = (const float *)buffer.floatChannelData[channel];
            sample.data.push_back(channelData[frame]);
        }
    }

    if (sample.data.size() > 0) {
        wrapper->callback(sample);
    }
}

} // namespace

MicrophoneCaptureWrapper::MicrophoneCaptureWrapper() {
    MicWrapperImpl *wrapper = new MicWrapperImpl();
    wrapper->objcImpl = [[MicrophoneCaptureImpl alloc] init];
    impl = wrapper;
}

MicrophoneCaptureWrapper::~MicrophoneCaptureWrapper() {
    if (impl) {
        MicWrapperImpl *wrapper = static_cast<MicWrapperImpl*>(impl);
        [wrapper->objcImpl stopCapture];
        [wrapper->objcImpl release];
        delete wrapper;
        impl = nullptr;
    }
}

bool MicrophoneCaptureWrapper::startCapture(const CaptureConfig& config, std::function<void(const AudioSample&)> callback) {
    if (!impl) return false;

    MicWrapperImpl *wrapper = static_cast<MicWrapperImpl*>(impl);
    std::lock_guard<std::mutex> lock(wrapper->mutex);

    if (wrapper->objcImpl.isCapturing) {
        return false; // Already capturing
    }

    wrapper->callback = callback;

    AVAudioEngine *engine = [[AVAudioEngine alloc] init];
    AVAudioInputNode *inputNode = engine.inputNode;
    AVAudioFormat *inputFormat = [inputNode outputFormatForBus:0];

    if (!inputFormat || inputFormat.channelCount == 0) {
        NSLog(@"No microphone input available");
        [engine release];
        return false;
    }

    // The tap below uses format:nil, so it adopts the input node's native
    // format. The actual sample rate is read from each buffer at runtime, so
    // we do not force a specific input format here.
    NSError *error = nil;

    __block MicWrapperImpl *blockWrapper = wrapper;
    [inputNode installTapOnBus:0
                    bufferSize:4096
                        format:nil
                         block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
        (void)when;
        HandleMicBuffer(buffer, blockWrapper);
    }];

    [engine prepare];
    if (![engine startAndReturnError:&error]) {
        NSLog(@"Failed to start audio engine: %@", error.localizedDescription);
        [inputNode removeTapOnBus:0];
        [engine release];
        return false;
    }

    wrapper->objcImpl.engine = engine;
    [engine release]; // Transfer ownership to engine property
    wrapper->objcImpl.isCapturing = YES;
    return true;
}

void MicrophoneCaptureWrapper::stopCapture() {
    if (!impl) return;

    MicWrapperImpl *wrapper = static_cast<MicWrapperImpl*>(impl);
    std::lock_guard<std::mutex> lock(wrapper->mutex);

    [wrapper->objcImpl stopCapture];
    wrapper->callback = nullptr;
}

bool MicrophoneCaptureWrapper::isCapturing() const {
    if (!impl) return false;

    MicWrapperImpl *wrapper = static_cast<MicWrapperImpl*>(impl);
    return wrapper->objcImpl.isCapturing;
}

} // namespace screencapturekit

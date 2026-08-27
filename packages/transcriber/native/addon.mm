#include <napi.h>
#include "wrapper.h"
#include <memory>

using namespace screencapturekit;

// Class to wrap the ScreenCaptureKit functionality
class ScreenCaptureAddon : public Napi::ObjectWrap<ScreenCaptureAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    ScreenCaptureAddon(const Napi::CallbackInfo& info);
    ~ScreenCaptureAddon();

private:
    static Napi::FunctionReference constructor;

    void ReleaseTSFN();

    Napi::Value GetAvailableApps(const Napi::CallbackInfo& info);
    Napi::Value StartCapture(const Napi::CallbackInfo& info);
    Napi::Value StopCapture(const Napi::CallbackInfo& info);
    Napi::Value IsCapturing(const Napi::CallbackInfo& info);

    using NativeStartFunction = std::function<bool(const CaptureConfig&, const std::function<void(const AudioSample&)>&)>;
    Napi::Value StartCaptureWithConfig(const Napi::CallbackInfo& info, const NativeStartFunction& starter);

    std::unique_ptr<ScreenCaptureKitWrapper> wrapper_;
    Napi::ThreadSafeFunction tsfn_;
};

// Parse a JS config object into a native CaptureConfig. Shared by both the
// ScreenCaptureKit and microphone addon classes.
CaptureConfig ParseCaptureConfig(Napi::Env env, const Napi::Object& configObj) {
    CaptureConfig config;

    if (configObj.Has("sampleRate")) {
        Napi::Value val = configObj.Get("sampleRate");
        if (val.IsNumber()) {
            config.sampleRate = val.As<Napi::Number>().Int32Value();
        }
    }
    if (configObj.Has("channels")) {
        Napi::Value val = configObj.Get("channels");
        if (val.IsNumber()) {
            config.channels = val.As<Napi::Number>().Int32Value();
        }
    }
    if (configObj.Has("bufferSize")) {
        Napi::Value bufferSizeVal = configObj.Get("bufferSize");
        if (!bufferSizeVal.IsUndefined() && bufferSizeVal.IsNumber()) {
            config.bufferSize = bufferSizeVal.As<Napi::Number>().Int32Value();
        }
    }

    return config;
}

Napi::FunctionReference ScreenCaptureAddon::constructor;

Napi::Object ScreenCaptureAddon::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ScreenCaptureKit", {
        InstanceMethod("getAvailableApps", &ScreenCaptureAddon::GetAvailableApps),
        InstanceMethod("startCapture", &ScreenCaptureAddon::StartCapture),
        InstanceMethod("stopCapture", &ScreenCaptureAddon::StopCapture),
        InstanceMethod("isCapturing", &ScreenCaptureAddon::IsCapturing),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("ScreenCaptureKit", func);
    return exports;
}

ScreenCaptureAddon::ScreenCaptureAddon(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ScreenCaptureAddon>(info) {
    wrapper_ = std::make_unique<ScreenCaptureKitWrapper>();
}

void ScreenCaptureAddon::ReleaseTSFN() {
    if (tsfn_) {
        tsfn_.Release();
        tsfn_ = Napi::ThreadSafeFunction(); // Reset to avoid double-release on teardown
    }
}

ScreenCaptureAddon::~ScreenCaptureAddon() {
    if (wrapper_) {
        wrapper_->stopCapture();
    }

    ReleaseTSFN();
}

Napi::Value ScreenCaptureAddon::GetAvailableApps(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        Napi::TypeError::New(env, "Wrapper not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<AppInfo> apps = wrapper_->getAvailableApps();

    Napi::Array result = Napi::Array::New(env, apps.size());

    for (size_t i = 0; i < apps.size(); i++) {
        Napi::Object appObj = Napi::Object::New(env);
        appObj.Set("processId", Napi::Number::New(env, apps[i].processId));
        appObj.Set("bundleIdentifier", Napi::String::New(env, apps[i].bundleIdentifier));
        appObj.Set("applicationName", Napi::String::New(env, apps[i].applicationName));
        result[i] = appObj;
    }

    return result;
}

Napi::Value ScreenCaptureAddon::StartCaptureWithConfig(const Napi::CallbackInfo& info, const NativeStartFunction& starter) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        Napi::Error::New(env, "Wrapper not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: targetId, config, and callback").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[1].IsObject()) {
        Napi::TypeError::New(env, "Second argument must be an object (config)").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[2].IsFunction()) {
        Napi::TypeError::New(env, "Third argument must be a function (callback)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object configObj = info[1].As<Napi::Object>();
    CaptureConfig config = ParseCaptureConfig(env, configObj);
    Napi::Function callback = info[2].As<Napi::Function>();

    ReleaseTSFN();

    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "AudioCallback",
        0,
        1,
        [](Napi::Env) {}
    );

    auto nativeCallback = [this](const AudioSample& sample) {
        auto callback = [sample](Napi::Env env, Napi::Function jsCallback) {
            Napi::HandleScope scope(env);

            try {
                Napi::Object sampleObj = Napi::Object::New(env);

                Napi::Buffer<float> buffer = Napi::Buffer<float>::Copy(
                    env,
                    sample.data.data(),
                    sample.data.size()
                );

                sampleObj.Set("data", buffer);
                sampleObj.Set("sampleRate", Napi::Number::New(env, sample.sampleRate));
                sampleObj.Set("channelCount", Napi::Number::New(env, sample.channelCount));
                sampleObj.Set("timestamp", Napi::Number::New(env, sample.timestamp));

                jsCallback.Call({sampleObj});

                if (env.IsExceptionPending()) {
                    Napi::Error error = env.GetAndClearPendingException();
                    fprintf(stderr, "Error in audio callback: %s\n", error.Message().c_str());
                }
            } catch (const Napi::Error& e) {
                fprintf(stderr, "N-API Error in audio callback: %s\n", e.Message().c_str());
            } catch (const std::exception& e) {
                fprintf(stderr, "C++ Exception in audio callback: %s\n", e.what());
            } catch (...) {
                fprintf(stderr, "Unknown exception in audio callback\n");
            }
        };

        if (tsfn_) {
            tsfn_.BlockingCall(callback);
        }
    };

    bool success = starter(config, nativeCallback);
    return Napi::Boolean::New(env, success);
}

Napi::Value ScreenCaptureAddon::StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: processId, config, and callback").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "First argument must be a number (processId)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int processId = info[0].As<Napi::Number>().Int32Value();
    auto starter = [this, processId](const CaptureConfig& config, const std::function<void(const AudioSample&)>& cb) {
        return wrapper_->startCapture(processId, config, cb);
    };

    return StartCaptureWithConfig(info, starter);
}

Napi::Value ScreenCaptureAddon::StopCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        Napi::TypeError::New(env, "Wrapper not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    wrapper_->stopCapture();

    ReleaseTSFN();

    return env.Undefined();
}

Napi::Value ScreenCaptureAddon::IsCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, wrapper_->isCapturing());
}

// Class to wrap microphone capture via AVAudioEngine
class MicrophoneAddon : public Napi::ObjectWrap<MicrophoneAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    MicrophoneAddon(const Napi::CallbackInfo& info);
    ~MicrophoneAddon();

private:
    static Napi::FunctionReference constructor;

    void ReleaseTSFN();

    Napi::Value StartCapture(const Napi::CallbackInfo& info);
    Napi::Value StopCapture(const Napi::CallbackInfo& info);
    Napi::Value IsCapturing(const Napi::CallbackInfo& info);

    std::unique_ptr<MicrophoneCaptureWrapper> wrapper_;
    Napi::ThreadSafeFunction tsfn_;
};

Napi::FunctionReference MicrophoneAddon::constructor;

Napi::Object MicrophoneAddon::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "MicrophoneCapture", {
        InstanceMethod("startCapture", &MicrophoneAddon::StartCapture),
        InstanceMethod("stopCapture", &MicrophoneAddon::StopCapture),
        InstanceMethod("isCapturing", &MicrophoneAddon::IsCapturing),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("MicrophoneCapture", func);
    return exports;
}

MicrophoneAddon::MicrophoneAddon(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<MicrophoneAddon>(info) {
    wrapper_ = std::make_unique<MicrophoneCaptureWrapper>();
}

void MicrophoneAddon::ReleaseTSFN() {
    if (tsfn_) {
        tsfn_.Release();
        tsfn_ = Napi::ThreadSafeFunction();
    }
}

MicrophoneAddon::~MicrophoneAddon() {
    if (wrapper_) {
        wrapper_->stopCapture();
    }
    ReleaseTSFN();
}

Napi::Value MicrophoneAddon::StartCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        Napi::TypeError::New(env, "Wrapper not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: config, and callback").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "First argument must be an object (config)").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[1].IsFunction()) {
        Napi::TypeError::New(env, "Second argument must be a function (callback)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object configObj = info[0].As<Napi::Object>();
    CaptureConfig config = ParseCaptureConfig(env, configObj);
    Napi::Function callback = info[1].As<Napi::Function>();

    ReleaseTSFN();

    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "MicAudioCallback",
        0,
        1,
        [](Napi::Env) {}
    );

    auto nativeCallback = [this](const AudioSample& sample) {
        auto callback = [sample](Napi::Env env, Napi::Function jsCallback) {
            Napi::HandleScope scope(env);

            try {
                Napi::Object sampleObj = Napi::Object::New(env);
                Napi::Buffer<float> buffer = Napi::Buffer<float>::Copy(
                    env,
                    sample.data.data(),
                    sample.data.size()
                );
                sampleObj.Set("data", buffer);
                sampleObj.Set("sampleRate", Napi::Number::New(env, sample.sampleRate));
                sampleObj.Set("channelCount", Napi::Number::New(env, sample.channelCount));
                sampleObj.Set("timestamp", Napi::Number::New(env, sample.timestamp));
                jsCallback.Call({sampleObj});

                if (env.IsExceptionPending()) {
                    Napi::Error error = env.GetAndClearPendingException();
                    fprintf(stderr, "Error in mic audio callback: %s\n", error.Message().c_str());
                }
            } catch (const Napi::Error& e) {
                fprintf(stderr, "N-API Error in mic audio callback: %s\n", e.Message().c_str());
            } catch (const std::exception& e) {
                fprintf(stderr, "C++ Exception in mic audio callback: %s\n", e.what());
            } catch (...) {
                fprintf(stderr, "Unknown exception in mic audio callback\n");
            }
        };

        if (tsfn_) {
            tsfn_.BlockingCall(callback);
        }
    };

    bool success = wrapper_->startCapture(config, nativeCallback);
    return Napi::Boolean::New(env, success);
}

Napi::Value MicrophoneAddon::StopCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        Napi::TypeError::New(env, "Wrapper not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    wrapper_->stopCapture();
    ReleaseTSFN();
    return env.Undefined();
}

Napi::Value MicrophoneAddon::IsCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!wrapper_) {
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, wrapper_->isCapturing());
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    ScreenCaptureAddon::Init(env, exports);
    return MicrophoneAddon::Init(env, exports);
}

NODE_API_MODULE(screencapturekit_addon, Init)

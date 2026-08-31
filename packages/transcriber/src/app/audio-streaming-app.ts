import type { SttMessage, TranscriptionEvent } from '@roofle/shared';
import { AudioCaptureEngine } from '../capture/audio-capture-engine';
import { MetricsTracker } from '../metrics/metrics';
import { EchoSuppressor } from '../pipeline/echo-suppressor';
import { SourcePipeline } from '../pipeline/source-pipeline';
import { SttWebSocketClient } from '../transport/stt-websocket-client';
import { AudioSource, type AppConfig, type TimestampedAudioFrame } from '../types';

export interface AudioStreamingAppOptions {
  readonly config: AppConfig;
  // Stable id for the current transcription session. Defaults to a fresh one.
  readonly sessionId?: string;
  // Forwarded to the UI for live subtitles.
  readonly onStt: (message: SttMessage, latencyMs: number | undefined, source: string) => void;
  // Forwarded to the analyst for paragraph building + question generation.
  readonly onTranscription: (event: TranscriptionEvent) => void;
}

export class AudioStreamingApp {
  private readonly config: AppConfig;
  private readonly metrics: MetricsTracker;
  private readonly onStt: AudioStreamingAppOptions['onStt'];
  private readonly onTranscription: AudioStreamingAppOptions['onTranscription'];
  private readonly echoSuppressor: EchoSuppressor;
  private readonly sessionId: string;

  private engine: AudioCaptureEngine | null = null;
  private pipelines: SourcePipeline[] = [];
  private wsClients: SttWebSocketClient[] = [];
  private built = false;
  private running = false;
  private paused = false;
  private metricsTimer: NodeJS.Timeout | null = null;
  private lastSentCaptureMs = 0;
  private suppressedMicFrames = 0;
  // Monotonic counter of finalized transcriptions forwarded to the analyst.
  private sequence = 0;

  constructor(options: AudioStreamingAppOptions) {
    this.config = options.config;
    this.onStt = options.onStt;
    this.onTranscription = options.onTranscription;
    this.sessionId = options.sessionId ?? `conv-${Date.now()}`;

    this.metrics = new MetricsTracker();

    this.echoSuppressor = new EchoSuppressor({
      enabled: this.config.echoSuppressionEnabled,
      threshold: this.config.echoSuppressionThreshold,
      hangoverMs: this.config.echoSuppressionHangoverMs,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!this.built) {
      this.build();
    }

    const engine = this.engine as AudioCaptureEngine;

    // Lock system audio routing to a single application. No arbitrary
    // fallback: if no configured hint matches, we fail loudly instead of
    // capturing from an unintended app.
    if (this.config.captureSystemAudio) {
      const app = engine.pickApplication(this.config.appHints);
      if (!app) {
        const apps = engine.listApplications();
        const names = apps.map((candidate) => candidate.applicationName).join(', ');
        throw new Error(
          `No capturable audio application matched hints [${this.config.appHints.join(', ')}]. ` +
            `Available: ${names || 'none'}`
        );
      }
    }

    this.running = true;
    this.paused = false;

    console.log(`WebSocket destination: ${this.config.wsUrl}`);
    if (this.config.captureMicrophone) {
      console.log('Capturing microphone');
    }
    if (this.config.captureSystemAudio) {
      const app = engine.getSelectedApplication();
      console.log(`Capturing application: ${app?.applicationName} (pid: ${app?.processId})`);
    }

    for (const client of this.wsClients) {
      client.connect();
    }

    const selectedApp = engine.getSelectedApplication();
    engine.start(selectedApp?.processId ?? 0);

    for (const pipeline of this.pipelines) {
      pipeline.start();
    }

    if (this.config.logMetrics) {
      this.metricsTimer = setInterval(() => {
        const snapshot = this.metrics.snapshot();
        console.log(
          `[metrics] queueBytes=${snapshot.queueBytes} queueDrops=${snapshot.queueDrops} chunksSent=${snapshot.chunksSent} chunksDropped=${snapshot.chunksDropped} reconnects=${snapshot.reconnectCount} avgSendLatencyMs=${snapshot.avgCaptureToSendLatencyMs.toFixed(1)} avgTranscriptionLatencyMs=${snapshot.avgTranscriptionLatencyMs.toFixed(1)} lastTranscriptionLatencyMs=${snapshot.lastTranscriptionLatencyMs.toFixed(1)} suppressedMicFrames=${this.suppressedMicFrames}`
        );
      }, 5000);
    }
  }

  // Pauses capture without tearing down the session: the engine stops feeding
  // frames, but pipelines and STT connections stay alive so resume is instant.
  pause(): void {
    if (!this.running || this.paused) return;
    this.engine?.stop();
    this.paused = true;
  }

  // Resumes capture after a pause, reusing the already-selected application.
  resume(): void {
    if (!this.running || !this.paused) return;
    const engine = this.engine as AudioCaptureEngine;
    const selectedApp = engine.getSelectedApplication();
    engine.start(selectedApp?.processId ?? 0);
    this.paused = false;
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.paused = false;

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    this.engine?.stop();

    for (const pipeline of this.pipelines) {
      await pipeline.stop();
    }

    for (const client of this.wsClients) {
      client.close();
    }

    this.engine?.dispose();
    this.engine = null;
    this.pipelines = [];
    this.wsClients = [];
    this.built = false;

    const snapshot = this.metrics.snapshot();
    console.log('Final metrics:', snapshot);
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private build(): void {
    const bytesPerSecond = this.config.inputSampleRate * this.config.inputChannels * 4;
    const queueMaxBytes = Math.max(1, Math.floor((bytesPerSecond * this.config.queueMaxMs) / 1000));

    const chunkSizeBytes = Math.floor(
      this.config.outputSampleRate * (this.config.chunkDurationMs / 1000) * this.config.outputChannels * 2
    );

    this.engine = new AudioCaptureEngine({
      sampleRate: this.config.inputSampleRate,
      channels: this.config.inputChannels,
      captureMicrophone: this.config.captureMicrophone,
      captureSystemAudio: this.config.captureSystemAudio,
    });

    this.buildPipelines(queueMaxBytes, chunkSizeBytes);
    this.attachHandlers();
    this.built = true;
  }

  private buildPipelines(queueMaxBytes: number, chunkSizeBytes: number): void {
    const sources: AudioSource[] = [];
    if (this.config.captureMicrophone) sources.push(AudioSource.MICROPHONE);
    if (this.config.captureSystemAudio) sources.push(AudioSource.SYSTEM_AUDIO);

    for (const source of sources) {
      const wsClient = new SttWebSocketClient({
        url: this.config.wsUrl,
        token: this.config.wsToken,
        source,
        maxBufferedBytes: this.config.maxWsBufferedBytes,
        maxQueueBytes: this.config.maxWsQueueBytes,
        reconnectBaseDelayMs: this.config.reconnectBaseDelayMs,
        reconnectMaxDelayMs: this.config.reconnectMaxDelayMs,
      });
      this.wsClients.push(wsClient);

      const pipeline = new SourcePipeline({
        source,
        outputSampleRate: this.config.outputSampleRate,
        outputChannels: this.config.outputChannels,
        chunkSizeBytes,
        queueMaxBytes,
        vadEnabled: this.config.vadEnabled,
        vadThreshold: this.config.vadThreshold,
        wsClient,
      });

      pipeline.on('queue-updated', (bytes: number, drops: number) => {
        this.metrics.setQueueBytes(bytes);
        this.metrics.setQueueDrops(drops);
      });

      pipeline.on('chunk-dropped', () => {
        this.metrics.addChunkDropped();
      });

      pipeline.on('conversion-error', (error: unknown) => {
        this.metrics.addConversionError();
        const message = error instanceof Error ? error.message : String(error);
        console.error('Conversion error:', message);
      });

      this.pipelines.push(pipeline);
    }
  }

  private attachHandlers(): void {
    const engine = this.engine as AudioCaptureEngine;

    engine.on('audio', (frame: TimestampedAudioFrame) => {
      // Feed system-audio frames into the echo suppressor so it knows when the
      // speaker is active, then gate mic frames while the speaker is playing.
      if (frame.source === AudioSource.SYSTEM_AUDIO) {
        this.echoSuppressor.updateSystem(frame);
      } else if (frame.source === AudioSource.MICROPHONE) {
        if (!this.echoSuppressor.shouldPassMic()) {
          this.suppressedMicFrames += 1;
          return;
        }
      }

      const pipeline = this.pipelines.find((candidate) => candidate.getSource() === frame.source);
      pipeline?.push(frame);
    });

    engine.on('error', (error: Error) => {
      console.error('Capture error:', error.message);
    });

    for (const client of this.wsClients) {
      this.attachWsClientHandlers(client);
    }
  }

  private attachWsClientHandlers(client: SttWebSocketClient): void {
    client.on('chunk-sent', (packet: { payload: Buffer; captureTimestampMs: number }) => {
      const latency = Date.now() - packet.captureTimestampMs;
      this.metrics.addChunkSent(packet.payload.byteLength, latency);
      this.lastSentCaptureMs = packet.captureTimestampMs;
    });

    client.on('chunk-dropped', () => {
      this.metrics.addChunkDropped();
    });

    client.on('send-failure', (error: unknown) => {
      this.metrics.addWsSendFailure();
      const message = error instanceof Error ? error.message : String(error);
      console.error('WebSocket send failure:', message);
    });

    client.on('reconnect', (_attempt: number, _delayMs: number) => {
      this.metrics.addReconnect();
    });

    client.on('error', (error: Error) => {
      console.error('WebSocket error:', error.message);
    });

    client.on('message', (message: string) => {
      if (message.length === 0) return;

      let latencyMs: number | undefined;
      if (this.lastSentCaptureMs > 0) {
        latencyMs = Date.now() - this.lastSentCaptureMs;
        this.metrics.addTranscriptionLatency(latencyMs);
      }

      const parsed = this.parseStt(message);
      if (!parsed) return;

      this.onStt(parsed, latencyMs, client.getSource());
      this.forwardToAnalyst(parsed, client.getSource());

      // Only log the full STT payload when explicitly enabled via LOG_METRICS.
      if (this.config.logMetrics) {
        console.log(`[stt] ${message}`);
      }
    });
  }

  private parseStt(message: string): SttMessage | undefined {
    try {
      return JSON.parse(message) as SttMessage;
    } catch {
      return undefined;
    }
  }

  private forwardToAnalyst(message: SttMessage, source: string): void {
    // Only finalized transcriptions build paragraphs; live partials are skipped.
    if (message.type !== 'final') return;
    if (!message.text) return;

    this.sequence += 1;

    this.onTranscription({
      type: 'final',
      sessionId: this.sessionId,
      sequence: this.sequence,
      text: message.text,
      start: message.start ?? 0,
      end: message.end ?? 0,
      source,
      timestampMs: Date.now(),
    });
  }
}

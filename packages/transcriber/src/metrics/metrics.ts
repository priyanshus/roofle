import type { PipelineMetricsSnapshot } from '../types';

export class MetricsTracker {
  private queueBytes = 0;
  private queueDrops = 0;
  private chunksSent = 0;
  private chunksDropped = 0;
  private bytesSent = 0;
  private reconnectCount = 0;
  private conversionErrors = 0;
  private wsSendFailures = 0;
  private latencyCount = 0;
  private latencyTotalMs = 0;
  private e2eLatencyCount = 0;
  private e2eLatencyTotalMs = 0;
  private lastE2eLatencyMs = 0;

  setQueueBytes(bytes: number): void {
    this.queueBytes = bytes;
  }

  setQueueDrops(drops: number): void {
    this.queueDrops = drops;
  }

  addChunkSent(bytes: number, captureToSendLatencyMs: number): void {
    this.chunksSent += 1;
    this.bytesSent += bytes;
    if (captureToSendLatencyMs >= 0) {
      this.latencyTotalMs += captureToSendLatencyMs;
      this.latencyCount += 1;
    }
  }

  addChunkDropped(): void {
    this.chunksDropped += 1;
  }

  addReconnect(): void {
    this.reconnectCount += 1;
  }

  addConversionError(): void {
    this.conversionErrors += 1;
  }

  addWsSendFailure(): void {
    this.wsSendFailures += 1;
  }

  addTranscriptionLatency(latencyMs: number): void {
    if (latencyMs < 0) return;
    this.e2eLatencyTotalMs += latencyMs;
    this.e2eLatencyCount += 1;
    this.lastE2eLatencyMs = latencyMs;
  }

  snapshot(): PipelineMetricsSnapshot {
    return {
      queueBytes: this.queueBytes,
      queueDrops: this.queueDrops,
      chunksSent: this.chunksSent,
      chunksDropped: this.chunksDropped,
      bytesSent: this.bytesSent,
      reconnectCount: this.reconnectCount,
      conversionErrors: this.conversionErrors,
      wsSendFailures: this.wsSendFailures,
      avgCaptureToSendLatencyMs:
        this.latencyCount === 0 ? 0 : this.latencyTotalMs / this.latencyCount,
      avgTranscriptionLatencyMs:
        this.e2eLatencyCount === 0 ? 0 : this.e2eLatencyTotalMs / this.e2eLatencyCount,
      lastTranscriptionLatencyMs: this.lastE2eLatencyMs,
    };
  }
}

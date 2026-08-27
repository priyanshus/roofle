// Runs analysis jobs off the ingest thread with a concurrency cap and retry,
// so LLM latency never blocks transcription ingestion.
export interface AnalysisJob {
  execute(): Promise<unknown>;
}

export class AnalysisWorker {
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly onResult: (result: unknown) => void;
  private readonly queue: AnalysisJob[] = [];
  private active = 0;

  constructor(options: {
    concurrency?: number;
    maxRetries?: number;
    onResult: (result: unknown) => void;
  }) {
    this.concurrency = options.concurrency ?? 2;
    this.maxRetries = options.maxRetries ?? 2;
    this.onResult = options.onResult;
  }

  enqueue(job: AnalysisJob): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.active += 1;
      this.run(job)
        .catch((err) => console.error('[analysis] failed:', err))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  private async run(job: AnalysisJob, attempt = 0): Promise<void> {
    try {
      const result = await job.execute();
      this.onResult(result);
    } catch (err) {
      if (attempt < this.maxRetries) {
        await this.delay(this.backoff(attempt));
        return this.run(job, attempt + 1);
      }
      throw err;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 10000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

import type { TimestampedAudioFrame } from '../types';

interface QueueItem {
  readonly frame: TimestampedAudioFrame;
  readonly bytes: number;
}

export class BoundedAudioQueue {
  private readonly maxBytes: number;
  private items: QueueItem[] = [];
  private totalBytes = 0;
  private dropped = 0;
  private waiters: Array<(value: TimestampedAudioFrame | null) => void> = [];
  private closed = false;

  constructor(maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error('maxBytes must be a positive number');
    }
    this.maxBytes = maxBytes;
  }

  push(frame: TimestampedAudioFrame): void {
    if (this.closed) return;

    const bytes = frame.data.byteLength;

    while (this.totalBytes + bytes > this.maxBytes && this.items.length > 0) {
      const removed = this.items.shift();
      if (!removed) break;
      this.totalBytes -= removed.bytes;
      this.dropped += 1;
    }

    const item: QueueItem = { frame, bytes };

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(item.frame);
      return;
    }

    this.items.push(item);
    this.totalBytes += bytes;
  }

  async pop(): Promise<TimestampedAudioFrame | null> {
    if (this.items.length > 0) {
      const item = this.items.shift();
      if (!item) return null;
      this.totalBytes -= item.bytes;
      return item.frame;
    }

    if (this.closed) {
      return null;
    }

    return new Promise<TimestampedAudioFrame | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(null);
    }
  }

  sizeBytes(): number {
    return this.totalBytes;
  }

  droppedCount(): number {
    return this.dropped;
  }
}

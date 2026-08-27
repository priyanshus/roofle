import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { AudioSource } from '../types';

export interface AudioPacket {
  readonly payload: Buffer;
  readonly captureTimestampMs: number;
  readonly source: AudioSource;
}

export interface SttWebSocketClientOptions {
  readonly url: string;
  readonly token?: string;
  readonly source: AudioSource;
  readonly maxBufferedBytes: number;
  readonly maxQueueBytes: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaxDelayMs: number;
}

export class SttWebSocketClient extends EventEmitter {
  private readonly options: SttWebSocketClientOptions;
  private ws: WebSocket | null = null;
  private queue: AudioPacket[] = [];
  private queuedBytes = 0;
  private closing = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: SttWebSocketClientOptions) {
    super();
    this.options = options;
  }

  getSource(): AudioSource {
    return this.options.source;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.closing = false;
    const headers = this.options.token
      ? {
          Authorization: `Bearer ${this.options.token}`,
        }
      : undefined;

    const ws = new WebSocket(this.options.url, { headers });
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.emit('open');
      this.sendStart();
      this.flushQueuedAudio();
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.emit('message', data.toString());
    });

    ws.on('error', (error) => {
      this.emit('error', error);
    });

    ws.on('close', () => {
      this.emit('close');
      if (!this.closing) {
        this.scheduleReconnect();
      }
    });
  }

  sendAudio(packet: AudioPacket): boolean {
    const ws = this.ws;

    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > this.options.maxBufferedBytes) {
      return this.enqueue(packet);
    }

    try {
      ws.send(packet.payload, { binary: true });
      this.emit('chunk-sent', packet);
      return true;
    } catch (error) {
      this.emit('send-failure', error);
      return this.enqueue(packet);
    }
  }

  close(): void {
    this.closing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.sendStop();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private enqueue(packet: AudioPacket): boolean {
    while (this.queuedBytes + packet.payload.byteLength > this.options.maxQueueBytes && this.queue.length > 0) {
      const dropped = this.queue.shift();
      if (!dropped) break;
      this.queuedBytes -= dropped.payload.byteLength;
      this.emit('chunk-dropped', dropped);
    }

    if (this.queuedBytes + packet.payload.byteLength > this.options.maxQueueBytes) {
      this.emit('chunk-dropped', packet);
      return false;
    }

    this.queue.push(packet);
    this.queuedBytes += packet.payload.byteLength;
    return true;
  }

  private flushQueuedAudio(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.queue.length > 0 && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > this.options.maxBufferedBytes) {
        break;
      }

      const packet = this.queue.shift();
      if (!packet) break;

      this.queuedBytes -= packet.payload.byteLength;

      try {
        ws.send(packet.payload, { binary: true });
        this.emit('chunk-sent', packet);
      } catch (error) {
        this.emit('send-failure', error);
        break;
      }
    }
  }

  private sendStart(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const message = {
      type: 'start',
      source: this.options.source,
      audio: {
        encoding: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
      },
    };

    ws.send(JSON.stringify(message));
  }

  private sendStop(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify({
        type: 'stop',
      })
    );
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const backoff = Math.min(
      this.options.reconnectMaxDelayMs,
      this.options.reconnectBaseDelayMs * 2 ** (this.reconnectAttempts - 1)
    );

    this.emit('reconnect', this.reconnectAttempts, backoff);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }
}

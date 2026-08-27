import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface WhisperServerOptions {
  readonly pythonBin: string;
  readonly serverDir: string;
  readonly host: string;
  readonly port: number;
  readonly model: string;
  readonly device: string;
  readonly computeType: string;
  readonly onLog: (line: string) => void;
  readonly onExit: (code: number | null) => void;
}

/**
 * Manages the Python WhisperX WebSocket server as a child process. The server
 * is spawned before capture starts and torn down on app quit.
 */
export class WhisperServer {
  private readonly options: WhisperServerOptions;
  private child: ChildProcess | null = null;

  constructor(options: WhisperServerOptions) {
    this.options = options;
  }

  start(model: string = this.options.model): void {
    if (this.child) return;

    const serverPy = path.join(this.options.serverDir, 'server.py');
    if (!fs.existsSync(serverPy)) {
      throw new Error(`Whisper server not found at ${serverPy}`);
    }

    const env = {
      ...process.env,
      HOST: this.options.host,
      PORT: String(this.options.port),
      MODEL: model,
      DEVICE: this.options.device,
      COMPUTE_TYPE: this.options.computeType,
    };

    this.child = spawn(this.options.pythonBin, [serverPy], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.options.onLog(chunk.toString());
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.options.onLog(chunk.toString());
    });
    this.child.on('exit', (code) => {
      this.options.onExit(code);
      this.child = null;
    });
  }

  stop(): void {
    if (!this.child) return;
    this.child.kill('SIGTERM');
    this.child = null;
  }
}

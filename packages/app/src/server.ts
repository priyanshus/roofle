import { Analyst } from '@roofle/analyst';
import { PERSONAS, type MeetingAnalysis, type QuestionEvent, type SttMessage } from '@roofle/shared';
import { AudioStreamingApp, loadConfig as loadTranscriberConfig } from '@roofle/transcriber';
import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { loadAnalystConfig, resolvePaths, type AppPaths } from './config';
import { WhisperServer } from './whisper-server';

const WS_EVENTS = {
  stt: 'stt',
  question: 'question',
  status: 'status',
  meeting: 'meeting',
} as const;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

type CaptureState = 'stopped' | 'running' | 'paused';

class RoofleServer {
  private readonly paths: AppPaths;
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private whisper: WhisperServer | null = null;
  private transcriber: AudioStreamingApp | null = null;
  private analyst: Analyst | null = null;
  private captureState: CaptureState = 'stopped';
  private sessionId = `conv-${Date.now()}`;

  constructor() {
    this.paths = resolvePaths();

    this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  async start(): Promise<void> {
    const port = Number(process.env.PORT ?? 8080);
    const host = process.env.HOST ?? '127.0.0.1';

    this.sendStatus('starting');

    this.whisper = new WhisperServer({
      pythonBin:
        process.env.PYTHON_BIN ?? path.join(this.paths.whisperDir, '.venv', 'bin', 'python'),
      serverDir: this.paths.whisperDir,
      host: '127.0.0.1',
      port: 9000,
      model: process.env.WHISPER_MODEL ?? 'base',
      device: process.env.WHISPER_DEVICE ?? 'cpu',
      computeType: process.env.WHISPER_COMPUTE_TYPE ?? 'int8',
      onLog: (line) => console.log(`[whisper] ${line.trim()}`),
      onExit: (code) => {
        if (code !== 0) {
          this.sendStatus('error', `Whisper server exited with code ${code}`);
        }
      },
    });

    this.sendStatus('loading-model');
    this.whisper.start();

    this.analyst = new Analyst({
      config: loadAnalystConfig(),
      dbPath: this.paths.dbPath,
      onQuestion: (question) => this.sendQuestion(question),
      onMeetingUpdate: (analysis) => this.sendMeeting(analysis),
    });

    this.createTranscriber();

    await new Promise<void>((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(port, host, () => {
        this.httpServer.removeListener('error', reject);
        resolve();
      });
    });

    console.log(`Roofle UI available at http://${host}:${port}`);

    // Give the Python server a moment to load models before capture starts.
    await this.waitForWhisper();
    this.sendStatus('ready');
    this.sendCaptureState();
  }

  // Builds a fresh transcriber bound to the current session id. Called on boot
  // and after each new session.
  private createTranscriber(): void {
    const transcriberConfig = loadTranscriberConfig(process.env);
    this.transcriber = new AudioStreamingApp({
      config: transcriberConfig,
      sessionId: this.sessionId,
      onStt: (message, latencyMs, source) => this.sendStt(message, latencyMs, source),
      onTranscription: (event) => this.analyst?.ingest(event),
    });
  }

  private async startCapture(): Promise<void> {
    if (!this.transcriber) {
      this.createTranscriber();
    }
    await this.transcriber?.start();
    this.captureState = 'running';
    this.sendCaptureState();
  }

  private async stopCapture(): Promise<void> {
    await this.transcriber?.stop();
    this.captureState = 'stopped';
    this.sendCaptureState();
  }

  private pauseCapture(): void {
    this.transcriber?.pause();
    this.captureState = 'paused';
    this.sendCaptureState();
  }

  private resumeCapture(): void {
    this.transcriber?.resume();
    this.captureState = 'running';
    this.sendCaptureState();
  }

  // Mints a fresh session id, resets analyst in-memory state, and rebuilds the
  // transcriber so the next capture starts a clean conversation.
  private newSession(): void {
    this.transcriber?.stop();
    this.sessionId = `conv-${Date.now()}`;
    this.analyst?.newSession();
    this.createTranscriber();
    this.captureState = 'stopped';
    this.sendCaptureState();
  }

  private sendCaptureState(): void {
    this.broadcast(WS_EVENTS.status, { state: this.captureState, detail: this.captureState });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    if (this.handleApi(req, res, urlPath)) {
      return;
    }

    const root = path.resolve(this.paths.uiDir);
    let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);

    // Prevent path traversal outside the UI directory.
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // SPA fallback: let the client router handle unknown paths.
        filePath = path.join(root, 'index.html');
        fs.stat(filePath, (statErr, indexStats) => {
          if (statErr || !indexStats.isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          this.serveFile(res, filePath, indexStats.size);
        });
        return;
      }

      this.serveFile(res, filePath, stats.size);
    });
  }

  private serveFile(res: http.ServerResponse, filePath: string, size: number): void {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  }

  // Handles the JSON API. Returns true when the request was consumed.
  private handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    urlPath: string
  ): boolean {
    if (!urlPath.startsWith('/api/')) {
      return false;
    }

    if (req.method === 'GET' && urlPath === '/api/personas') {
      this.sendJson(res, 200, { personas: PERSONAS });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/api/capture/state') {
      this.sendJson(res, 200, { state: this.captureState, sessionId: this.sessionId });
      return true;
    }

    if (req.method === 'POST' && urlPath === '/api/capture/start') {
      this.startCapture().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.sendJson(res, 500, { error: message });
      });
      return true;
    }

    if (req.method === 'POST' && urlPath === '/api/capture/stop') {
      this.stopCapture().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.sendJson(res, 500, { error: message });
      });
      return true;
    }

    if (req.method === 'POST' && urlPath === '/api/capture/pause') {
      this.pauseCapture();
      this.sendJson(res, 200, { state: this.captureState });
      return true;
    }

    if (req.method === 'POST' && urlPath === '/api/capture/resume') {
      this.resumeCapture();
      this.sendJson(res, 200, { state: this.captureState });
      return true;
    }

    if (req.method === 'POST' && urlPath === '/api/capture/session') {
      this.newSession();
      this.sendJson(res, 200, { state: this.captureState, sessionId: this.sessionId });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/api/sessions') {
      const sessions = this.analyst?.getSessions() ?? [];
      this.sendJson(res, 200, { sessions });
      return true;
    }

    const sessionMatch = urlPath.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const session = this.analyst?.getSession(sessionId) ?? null;
      if (!session) {
        this.sendJson(res, 404, { error: 'Session not found' });
        return true;
      }
      this.sendJson(res, 200, { session });
      return true;
    }

    if (req.method === 'GET' && urlPath === '/api/meetings') {
      const analyses = this.analyst?.getMeetingAnalyses() ?? [];
      this.sendJson(res, 200, { analyses });
      return true;
    }

    const meetingMatch = urlPath.match(/^\/api\/meetings\/([^/]+)$/);
    if (meetingMatch) {
      const sessionId = decodeURIComponent(meetingMatch[1]);

      if (req.method === 'GET') {
        const query = new URL(req.url ?? '', 'http://localhost').searchParams;
        const persona = query.get('persona') ?? undefined;
        const personaContext = query.get('personaContext') ?? undefined;
        const analysis = this.analyst?.getMeetingAnalysis(sessionId, persona, personaContext) ?? null;
        if (!analysis) {
          this.sendJson(res, 404, { error: 'Meeting analysis not found' });
          return true;
        }
        this.sendJson(res, 200, { analysis });
        return true;
      }

      if (req.method === 'POST') {
        this.readJsonBody(req, (err, body) => {
          if (err) {
            this.sendJson(res, 400, { error: err.message });
            return;
          }

          const persona = typeof body?.persona === 'string' ? body.persona : undefined;
          const personaContext =
            typeof body?.personaContext === 'string' ? body.personaContext : undefined;

          const analysis = this.analyst?.analyzeMeeting(sessionId, persona, personaContext) ?? null;
          if (!analysis) {
            this.sendJson(res, 404, { error: 'Session not found' });
            return;
          }
          this.sendJson(res, 200, { analysis });
        });
        return true;
      }
    }

    this.sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  // Reads and parses a JSON request body. Empty bodies resolve to {}.
  private readJsonBody(
    req: http.IncomingMessage,
    cb: (err: Error | null, body?: Record<string, unknown>) => void
  ): void {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw.trim()) {
        cb(null, {});
        return;
      }
      try {
        cb(null, JSON.parse(raw) as Record<string, unknown>);
      } catch {
        cb(new Error('Invalid JSON body'));
      }
    });
    req.on('error', (err) => cb(err));
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  }

  private sendStt(message: SttMessage, latencyMs: number | undefined, source: string): void {
    this.broadcast(WS_EVENTS.stt, { message, latencyMs, source });
  }

  private sendQuestion(question: QuestionEvent): void {
    this.broadcast(WS_EVENTS.question, { question });
  }

  private sendMeeting(analysis: MeetingAnalysis): void {
    this.broadcast(WS_EVENTS.meeting, { analysis });
  }

  private sendStatus(state: string, detail?: string): void {
    this.broadcast(WS_EVENTS.status, { state, detail });
  }

  private broadcast(type: string, payload: Record<string, unknown>): void {
    if (this.clients.size === 0) return;
    const data = JSON.stringify({ type, ...payload });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private waitForWhisper(): Promise<void> {
    // The Python server blocks on model load before accepting connections.
    // Poll the WebSocket port until it accepts a connection.
    return new Promise((resolve) => {
      const deadline = Date.now() + 120_000;
      const attempt = () => {
        const net = require('net') as typeof import('net');
        const socket = net.connect(9000, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() > deadline) {
            resolve();
          } else {
            setTimeout(attempt, 1000);
          }
        });
      };
      attempt();
    });
  }

  async stop(): Promise<void> {
    await this.transcriber?.stop();
    this.analyst?.dispose();
    this.whisper?.stop();

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }
}

const server = new RoofleServer();

const shutdown = async () => {
  try {
    await server.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Shutdown error:', message);
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

server.start().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('Fatal error:', message);
  process.exit(1);
});

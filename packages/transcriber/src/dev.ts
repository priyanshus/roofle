import 'dotenv/config';
import { AudioStreamingApp } from './app/audio-streaming-app';
import { loadConfig } from './config';

// Standalone dev runner. The Electron app drives AudioStreamingApp directly
// with its own callbacks; this entry point is for testing capture in isolation.
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = new AudioStreamingApp({
    config,
    onStt: (message, latencyMs, source) => {
      const text = 'text' in message ? message.text : '';
      console.log(`[stt:${source}] ${message.type} ${text} (${latencyMs ?? '?'}ms)`);
    },
    onTranscription: (event) => {
      console.log(`[final] ${event.source}: ${event.text}`);
    },
  });

  const shutdown = async () => {
    try {
      await app.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Shutdown error:', message);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('Fatal error:', message);
  process.exit(1);
});

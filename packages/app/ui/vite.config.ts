import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Node server serves the built bundle and the API on the same origin, so
// no proxy is needed in production. The dev server proxies /api to the Node
// server for local development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

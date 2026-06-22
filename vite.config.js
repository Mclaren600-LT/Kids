import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // Forward /api to wrangler pages dev on port 8788 when running locally
      '/api': 'http://localhost:8788',
    },
  },
});

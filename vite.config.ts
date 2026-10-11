import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5310,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4310',
    },
  },
});

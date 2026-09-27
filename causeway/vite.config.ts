import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5180, host: true },
  preview: { port: 5181, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/postprocessing')) return 'three';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

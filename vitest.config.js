import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Backend tests exercise Node stdlib directly (node:sqlite, node:fs) and have
    // no DOM to speak of. jsdom is the default because most of the suite is
    // components; server/ is the exception.
    environmentMatchGlobs: [['tests/server/**', 'node']],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

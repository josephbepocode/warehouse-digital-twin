import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/warehouse-digital-twin/',
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docks: fileURLToPath(new URL('./docks/index.html', import.meta.url)),
      },
    },
  },
  test: { globals: true, environment: 'node' },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/warehouse-digital-twin/',
  build: { target: 'es2020' },
  test: { globals: true, environment: 'node' },
});

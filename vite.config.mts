import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@renderer': resolve(import.meta.dirname, 'src/renderer') } },
  build: { outDir: 'dist' },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/release/**'] }
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared'), '@renderer': resolve(import.meta.dirname, 'src/renderer') } },
  // The production renderer is loaded from a file:// URL inside Electron.
  // Relative asset paths are required for the packaged app (DMG/NSIS).
  base: './',
  build: { outDir: 'dist' },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/release/**'] }
});

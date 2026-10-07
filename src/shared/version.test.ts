import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { APP_VERSION } from './version';

it('keeps the UI and PDF version aligned with application and lockfile metadata', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  expect(APP_VERSION).toBe(manifest.version);
  expect(lock.version).toBe(APP_VERSION);
  expect(lock.packages[''].version).toBe(APP_VERSION);
});

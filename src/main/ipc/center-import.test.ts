import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase } from '../database/database';
import { parseCenterFile } from '../import/catalog-parser';
import { readFileSync } from 'node:fs';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn()
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler) },
  dialog: { showOpenDialog: electron.showOpenDialog },
  BrowserWindow: class {}
}));
import { registerIpc } from './register';

const initialPath = join(process.cwd(), 'examples', 'demo_01_school_initial_roster.json');
const changedPath = join(process.cwd(), 'examples', 'demo_02_school_carla_joins_eso1.json');
const initial = parseCenterFile(readFileSync(initialPath, 'utf8'), '.json');
if (!initial.ok) throw new Error(initial.error);

describe('IPC de actualización del centro', () => {
  let db: AppDatabase;
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = electron.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler(null, ...args) as Promise<Record<string, any>>;
  };
  beforeEach(() => {
    electron.handlers.clear();
    electron.showOpenDialog.mockReset();
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [changedPath] });
    db = new AppDatabase(':memory:');
    db.replaceCenterData(initial.courses, initial.centerConfiguration);
    registerIpc(db);
  });
  afterEach(() => db.close());

  it('impide la importación directa, cancela sin escribir y exige vista previa para aplicar', async () => {
    const before = db.getInitialState();
    expect(await invoke('configuration:center-import')).toMatchObject({ ok: false, code: 'CENTER_PREVIEW_REQUIRED' });
    expect(electron.showOpenDialog).not.toHaveBeenCalled();
    const analysis = await invoke('configuration:center-analyze');
    expect(analysis.ok).toBe(true);
    expect(analysis.preview.courses[0].added).toEqual(['Carla Costa']);
    expect(db.getInitialState()).toEqual(before);
    await invoke('configuration:center-cancel');
    expect(await invoke('configuration:center-apply', analysis.token, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }])).toMatchObject({ ok: false });
    expect(db.getInitialState()).toEqual(before);
    const refreshed = await invoke('configuration:center-analyze');
    expect(await invoke('configuration:center-apply', refreshed.token, null, [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }])).toMatchObject({ ok: false });
    expect(db.getInitialState()).toEqual(before);
    expect(await invoke('configuration:center-apply', refreshed.token, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }])).toMatchObject({ ok: true });
    expect(db.listActiveStudents('ESO_1').map(student => student.fullName)).toContain('Carla Costa');
  });
});

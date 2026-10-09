import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDatabase } from '../database/database';
import type { BackupSummary } from '../../shared/backup';

const fingerprint = (db: AppDatabase) => {
  const { tables, sequences } = db.exportBackup();
  return createHash('sha256').update(JSON.stringify({ tables, sequences })).digest('hex');
};

export class BackupService {
  private pending: { token: string; backup: unknown; revision: string } | null = null;
  constructor(private db: AppDatabase, private recoveryDirectory: string) {}

  async export(path: string) {
    await writeFile(path, JSON.stringify(this.db.exportBackup()), { encoding: 'utf8', flush: true });
  }

  async preview(path: string): Promise<{ token: string; summary: BackupSummary }> {
    this.pending = null;
    const backup: unknown = JSON.parse(await readFile(path, 'utf8'));
    const staging = new AppDatabase(':memory:');
    try {
      staging.restoreBackup(backup);
      const state = staging.getInitialState();
      const token = randomUUID();
      this.pending = { token, backup, revision: fingerprint(this.db) };
      return { token, summary: {
        createdAt: (backup as { createdAt: string }).createdAt,
        teacher: `${state.profile.firstName} ${state.profile.lastName}`.trim(),
        courses: state.courses.length, students: state.students.length,
        worksheets: state.worksheets.length, reports: state.trackingReports.length
      } };
    } finally { staging.close(); }
  }

  cancel() { this.pending = null; }

  async restore(token: string) {
    const pending = this.pending;
    if (!pending || token !== pending.token || fingerprint(this.db) !== pending.revision) throw new Error('BACKUP_PREVIEW_EXPIRED');
    await mkdir(this.recoveryDirectory, { recursive: true });
    const path = join(this.recoveryDirectory, `EduTrack-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.edutrack-backup`);
    await writeFile(path, JSON.stringify(this.db.exportBackup()), { encoding: 'utf8', flag: 'wx', flush: true });
    if (this.pending !== pending || fingerprint(this.db) !== pending.revision) throw new Error('BACKUP_PREVIEW_EXPIRED');
    this.db.restoreBackup(pending.backup);
    this.pending = null;
    return path;
  }
}

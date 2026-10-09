import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../database/database';
import { BackupService } from './backup-service';
import { DEFAULT_CENTER_CONFIGURATION } from '../../shared/center/center-configuration';
import { buildTrackingReports } from '../export/tracking-report-service';
import { buildStudentReportHtml } from '../export/student-report-pdf-service';
import { buildExport } from '../export/export-service';

describe('complete backups', () => {
  let directory: string;
  let source: AppDatabase;
  let target: AppDatabase;
  let service: BackupService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'edutrack-backup-'));
    source = new AppDatabase(':memory:'); target = new AppDatabase(':memory:');
    source.replaceCenterData([{ name: '1r ESO', subjects: ['Català'], students: ['Aina Bosch', 'Biel Casas'] }], DEFAULT_CENTER_CONFIGURATION);
    source.saveProfile({ firstName: 'Marta', lastName: 'Serra', sex: 'FEMALE' });
    source.saveLanguage('ca'); source.saveSchoolLogo('data:image/png;base64,logo');
    const sheet = source.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català', gradeMode: 'NUMERIC', isElective: false });
    const detail = source.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-10-09');
    for (const student of detail.students) {
      source.saveCell(sheet.id, student.id, detail.columns[0].id, 'grade', '8');
      source.saveCell(sheet.id, student.id, detail.columns[0].id, 'observation', 'Bon treball');
    }
    source.saveImport(buildExport(source, sheet.id), false);
    const reportId = source.listTrackingReports()[0].id;
    source.saveTutorObservation(reportId, detail.students[0].id, 'Observació del tutor');
    const payload = buildTrackingReports(source, reportId);
    source.saveIssuedReportSnapshot(reportId, payload, payload.students.map((_, i) => buildStudentReportHtml(payload, i)));
    service = new BackupService(target, join(directory, 'recovery'));
  });
  afterEach(async () => { source.close(); target.close(); await rm(directory, { recursive: true, force: true }); });

  const contents = (db: AppDatabase) => { const { tables, sequences } = db.exportBackup(); return { tables, sequences }; };

  it('restores teacher and tutor work, snapshots, preferences and history, with a recovery copy', async () => {
    const path = join(directory, 'school.edutrack-backup');
    await new BackupService(source, directory).export(path);
    const original = contents(target);
    const preview = await service.preview(path);
    expect(preview.summary).toMatchObject({ teacher: 'Marta Serra', courses: 1, students: 2, worksheets: 1, reports: 1 });
    expect(contents(target)).toEqual(original);
    const recovery = await service.restore(preview.token);
    expect(contents(target)).toEqual(contents(source));
    const previous = JSON.parse(await readFile(recovery, 'utf8'));
    expect({ tables: previous.tables, sequences: previous.sequences }).toEqual(original);
    // The automatic backup is itself restorable.
    const recoverPreview = await service.preview(recovery);
    await service.restore(recoverPreview.token);
    expect(contents(target)).toEqual(original);
  });

  it('rejects cancelled, unknown and outdated previews without replacing data', async () => {
    const path = join(directory, 'backup.edutrack-backup');
    await writeFile(path, JSON.stringify(source.exportBackup()));
    let preview = await service.preview(path);
    await expect(service.restore('wrong-token')).rejects.toThrow('BACKUP_PREVIEW_EXPIRED');
    service.cancel();
    await expect(service.restore(preview.token)).rejects.toThrow('BACKUP_PREVIEW_EXPIRED');
    preview = await service.preview(path);
    target.saveLanguage('en');
    const before = contents(target);
    await expect(service.restore(preview.token)).rejects.toThrow('BACKUP_PREVIEW_EXPIRED');
    expect(contents(target)).toEqual(before);
  });

  it('preserves enrollment dates and keeps normal enrollment creation working after restore', async () => {
    const roster = [{ name: '1r ESO', students: ['Aina Bosch', 'Carla Costa'] }];
    const analysis = source.analyzeCenterRoster(roster);
    source.applyCenterRoster(roster, '2026-10-09', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], analysis.revision);
    const path = join(directory, 'history.edutrack-backup');
    await new BackupService(source, directory).export(path);
    const preview = await service.preview(path);
    await service.restore(preview.token);
    expect(contents(target)).toEqual(contents(source));
    const student = target.addStudent('ESO_1', 'Nou Alumne');
    expect(target.exportBackup().tables.student_enrollments.rows.some(row => row.student_id === student.id)).toBe(true);
  });

  it('does not restore when the automatic recovery copy cannot be saved', async () => {
    const blocked = join(directory, 'not-a-directory');
    await writeFile(blocked, 'file');
    const blockedService = new BackupService(target, blocked);
    const path = join(directory, 'backup.edutrack-backup');
    await writeFile(path, JSON.stringify(source.exportBackup()));
    const preview = await blockedService.preview(path);
    const before = contents(target);
    await expect(blockedService.restore(preview.token)).rejects.toThrow();
    expect(contents(target)).toEqual(before);
  });

  it('rejects corrupted or incompatible files and rolls back invalid relationships', async () => {
    const before = contents(target);
    expect(() => target.restoreBackup({ format: 'edutrack-backup', version: 2 })).toThrow();
    const missing = source.exportBackup(); delete missing.tables.students;
    expect(() => target.restoreBackup(missing)).toThrow('INCOMPATIBLE_BACKUP');
    const orphan = source.exportBackup(); orphan.tables.students.rows = [];
    expect(() => target.restoreBackup(orphan)).toThrow();
    expect(contents(target)).toEqual(before);
    const malformed = join(directory, 'malformed.edutrack-backup');
    await writeFile(malformed, '{');
    await expect(service.preview(malformed)).rejects.toThrow();
    expect(contents(target)).toEqual(before);
  });
});

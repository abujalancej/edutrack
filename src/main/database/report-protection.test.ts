import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CENTER_CONFIGURATION } from '../../shared/center/center-configuration';
import type { FullSeguimentExport } from '../../shared/types/models';
import { buildStudentReportHtml } from '../export/student-report-pdf-service';
import { buildTrackingReports } from '../export/tracking-report-service';
import { issueTrackingReport } from '../export/tracking-report-issue-service';
import { AppDatabase } from './database';

const center = [{ name: '1r ESO', subjects: ['Català'], students: ['Aina Bosch', 'Biel Casas'] }];
const roster = (names: string[]) => [{ name: '1r ESO', students: names }];
const file = (version: 1 | 2 = 1): FullSeguimentExport => ({
  format: 'full-seguiment', version, exportedAt: '2026-09-16T10:00:00.000Z',
  teacher: { firstName: 'Marta', lastName: 'Serra' },
  course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
  subject: { name: 'Català', gradeMode: 'NUMERIC' },
  columns: [{ id: 'exam', name: 'Examen', kind: 'EXAM', assessmentDate: '2026-09-10' }],
  students: ['Aina Bosch', 'Biel Casas'].map((name, index) => ({
    name, ...(version === 2 ? { enrolled: true, applicability: { exam: 'APPLICABLE' as const } } : {}),
    values: { exam: index ? 'NP' : '8' }, observations: { exam: 'Observación original' }
  }))
});

describe('entregas e informes protegidos', () => {
  let db: AppDatabase;
  beforeEach(() => { db = new AppDatabase(':memory:'); db.replaceCenterData(center, DEFAULT_CENTER_CONFIGURATION); });
  afterEach(() => db.close());

  it('permite borrar la única hoja emitida y limpia sus datos para volver a importar', () => {
    db.saveImport(file(), false);
    const reportId = db.listTrackingReports()[0].id;
    db.saveTutorObservation(reportId, db.listStudents('ESO_1')[0].id, 'Observación de tutoría');
    const payload = buildTrackingReports(db, reportId);
    db.saveIssuedReportSnapshot(reportId, payload, payload.students.map((_, index) => buildStudentReportHtml(payload, index)));
    expect(db.listTrackingReports()[0].snapshotOrigin).toBe('issued');

    db.deleteTrackingReport(reportId);

    expect(db.listTrackingReports()).toEqual([]);
    expect(db.getReportSnapshot(reportId)).toBeNull();
    expect(db.listImports()).toEqual([]);
    expect(db.listTutorObservations()).toEqual({});
    expect(db.listStudents('ESO_1')).toHaveLength(2);
    db.saveImport(file(), false);
    expect(db.listTrackingReports()).toHaveLength(1);
    expect(db.listTrackingReports()[0].sequence).toBe(1);
  });

  it('permite borrar una copia y después la última hoja emitida que queda', () => {
    db.saveImport(file(), false);
    const firstId = db.listTrackingReports()[0].id;
    const payload = buildTrackingReports(db, firstId);
    db.saveIssuedReportSnapshot(firstId, payload, payload.students.map((_, index) => buildStudentReportHtml(payload, index)));
    const second = db.copyTrackingReport(firstId);
    expect(() => db.deleteTrackingReport(firstId)).toThrow('ONLY_LATEST_REPORT_CAN_BE_DELETED');
    db.deleteTrackingReport(second.id);
    expect(db.listTrackingReports()).toHaveLength(1);
    expect(() => db.deleteTrackingReport(firstId)).not.toThrow();
    expect(db.listTrackingReports()).toEqual([]);
    expect(db.getReportSnapshot(firstId)).toBeNull();
  });

  it('lee v1 y v2 sin inventar notas y rechaza nombres ambiguos y listados distintos sin escribir', () => {
    db.saveImport(file(), false);
    expect(db.getImportedWorksheet(db.listImports()[0].id).payload.version).toBe(1);
    const v2 = file(2);
    db.saveImport(v2, true);
    expect(db.getImportedWorksheet(db.listImports()[0].id).payload.version).toBe(2);
    const before = db.listTrackingReports();
    const ambiguous = file(2);
    ambiguous.students[1].name = 'Aina Bosch';
    expect(() => db.saveImport(ambiguous, true)).toThrow(/Altas.*Biel Casas.*Bajas.*Aina Bosch/);
    expect(db.listTrackingReports()).toEqual(before);
    expect(db.getImportedWorksheet(db.listImports()[0].id).payload).toEqual(v2);
  });

  it('marca como desactualizada una entrega copiada tras cambiar el listado y la sustituye con v2', () => {
    db.saveImport(file(), false);
    const changed = roster(['Aina Bosch', 'Carla Costa']);
    db.applyCenterRoster(changed, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], db.analyzeCenterRoster(changed).revision);
    const old = db.listTrackingReports()[0];
    const oldVersionDelivery = file(2);
    oldVersionDelivery.students[1].enrolled = false;
    db.saveImport(oldVersionDelivery, true);
    expect(db.listImports(old.id)[0].isStale).toBe(false);
    expect(buildTrackingReports(db, old.id).students.map(student => student.name)).toContain('Biel Casas');
    const next = db.copyTrackingReport(old.id);
    expect(db.listImports(next.id)[0].isStale).toBe(true);
    expect(() => buildTrackingReports(db, next.id)).toThrow(/Biel Casas.*Carla Costa|Carla Costa.*Biel Casas/);
    const updated = file(2);
    updated.exportedAt = '2026-09-22T10:00:00.000Z';
    updated.students = [updated.students[0], { ...updated.students[1], enrolled: false }, { name: 'Carla Costa', enrolled: true, values: { exam: '' }, applicability: { exam: 'NOT_APPLICABLE' } }];
    db.saveImport(updated, true);
    expect(db.listImports(next.id)[0].isStale).toBe(false);
    const result = buildTrackingReports(db, next.id);
    expect(result.students.map(student => student.name)).toEqual(['Aina Bosch', 'Carla Costa']);
    expect(result.students[1].subjects[0].applicability).toEqual({ exam: 'NOT_APPLICABLE' });
    expect(buildStudentReportHtml(result, 1)).toContain('N/A');
    expect(db.getImportedWorksheet(db.listImports(next.id)[0].id).payload.students.map(student => student.name)).toContain('Biel Casas');
  });

  it('detecta un homónimo nuevo aunque el listado visible tenga los mismos nombres', () => {
    db.saveImport(file(), false);
    const previousId = db.listStudents('ESO_1').find(student => student.fullName === 'Biel Casas')!.id;
    const leaving = roster(['Aina Bosch']);
    db.applyCenterRoster(leaving, '2026-09-20', [], db.analyzeCenterRoster(leaving).revision);
    const returning = roster(['Aina Bosch', 'Biel Casas']);
    db.applyCenterRoster(returning, '2026-10-01', [{ courseId: 'ESO_1', incomingName: 'Biel Casas', studentId: null }], db.analyzeCenterRoster(returning).revision);
    expect(db.listActiveStudents('ESO_1')[1].id).not.toBe(previousId);
    const next = db.copyTrackingReport(db.listTrackingReports()[0].id);
    expect(db.listImports(next.id)[0].isStale).toBe(true);
    expect(() => buildTrackingReports(db, next.id)).toThrow(/desactualizada/);
    expect(() => db.saveImport(file(), true)).toThrow(/reexporta la entrega en formato v2/);
    const replacement = file(2);
    replacement.exportedAt = '2026-10-02T10:00:00.000Z';
    replacement.students[1].values.exam = '';
    replacement.students[1].applicability = { exam: 'NOT_APPLICABLE' };
    db.saveImport(replacement, true);
    expect(db.listImports(next.id)[0].isStale).toBe(false);
  });

  it('congela alumnado, nombre, catálogo, notas, observaciones, idioma y configuración al emitir', () => {
    db.saveImport(file(), false);
    const reportId = db.listTrackingReports()[0].id;
    const payload = buildTrackingReports(db, reportId);
    const html = payload.students.map((_, index) => buildStudentReportHtml(payload, index));
    db.saveIssuedReportSnapshot(reportId, payload, html);
    const changed = roster(['Aina Bosch', 'Carla Costa']);
    db.applyCenterRoster(changed, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], db.analyzeCenterRoster(changed).revision);
    const renamed = roster(['Aina Maria Bosch', 'Carla Costa']);
    db.applyCenterRoster(renamed, '2026-09-21', [{ courseId: 'ESO_1', incomingName: 'Aina Maria Bosch', studentId: db.listStudents('ESO_1')[0].id }], db.analyzeCenterRoster(renamed).revision);
    db.replaceCenterData([{ ...center[0], students: ['Aina Maria Bosch', 'Carla Costa'], subjects: ['Català', 'Matemàtiques'] }], DEFAULT_CENTER_CONFIGURATION);
    db.saveLanguage('en');
    db.saveCenterConfiguration({ ...DEFAULT_CENTER_CONFIGURATION, notEvaluatedValue: 'NP' });
    expect(buildTrackingReports(db, reportId)).toEqual(payload);
    expect(db.getReportSnapshot(reportId)?.html).toEqual(html);
    expect(db.getReportSnapshot(reportId)?.origin).toBe('issued');
    expect(() => db.saveIssuedReportSnapshot(reportId, payload, html)).toThrow('REPORT_ALREADY_SNAPSHOTTED');
    db.saveImport(file(), true);
    expect(db.getReportSnapshot(reportId)).toBeNull();
    expect(() => db.deleteTrackingReport(reportId)).not.toThrow();
  });

  it('solo guarda la instantánea tras exportar con éxito y usa el idioma actual al reexportar', async () => {
    db.saveImport(file(), false);
    const reportId = db.listTrackingReports()[0].id;
    const write = async () => 2;
    expect(await issueTrackingReport(db, reportId, async () => null, write)).toBeNull();
    expect(db.getReportSnapshot(reportId)).toBeNull();
    await expect(issueTrackingReport(db, reportId, async () => '/tmp', async () => { throw new Error('PDF_ERROR'); })).rejects.toThrow('PDF_ERROR');
    expect(db.getReportSnapshot(reportId)).toBeNull();
    const captured: string[][] = [];
    expect(await issueTrackingReport(db, reportId, async () => '/tmp', async (_data, _path, html) => { captured.push(html); return 2; })).toBe(2);
    db.saveLanguage('en');
    expect(await issueTrackingReport(db, reportId, async () => '/tmp', async (data, _path, html) => {
      expect(data.language).toBe('en');
      expect(html).not.toEqual(captured[0]);
      captured.push(html);
      return 2;
    })).toBe(2);
    expect(captured[1]).not.toEqual(captured[0]);
  });

  it('reconstruye informes antiguos sin atribuirles identidad exacta con el PDF original', () => {
    const directory = mkdtempSync(join(tmpdir(), 'edutrack-phase4-'));
    const path = join(directory, 'school.sqlite');
    try {
      const legacy = new AppDatabase(path);
      legacy.replaceCenterData(center, DEFAULT_CENTER_CONFIGURATION);
      legacy.saveImport(file(), false);
      const reportId = legacy.listTrackingReports()[0].id;
      const changed = roster(['Aina Bosch', 'Carla Costa']);
      legacy.applyCenterRoster(changed, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], legacy.analyzeCenterRoster(changed).revision);
      legacy.close();
      const raw = new DatabaseSync(path);
      raw.exec('DROP TABLE report_snapshots');
      raw.close();
      const migrated = new AppDatabase(path);
      expect(migrated.getReportSnapshot(reportId)?.origin).toBe('reconstructed');
      expect(migrated.getReportSnapshot(reportId)?.payload.students.map(student => student.name)).toEqual(['Aina Bosch', 'Biel Casas']);
      migrated.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

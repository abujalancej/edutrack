import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CENTER_CONFIGURATION } from '../../shared/center/center-configuration';
import { buildExport } from '../export/export-service';
import { buildTrackingReports } from '../export/tracking-report-service';
import { buildStudentReportHtml } from '../export/student-report-pdf-service';
import { validateImport } from '../import/validation';
import { AppDatabase } from './database';

const courses = [{ name: '3r ESO', subjects: ['Català'], students: ['Martina Velo Guillén', 'Alba Fernández Sánchez'] }];

describe('pruebas individuales', () => {
  let db: AppDatabase;
  beforeEach(() => {
    db = new AppDatabase(':memory:');
    db.replaceCenterData(courses, DEFAULT_CENTER_CONFIGURATION);
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
  });
  afterEach(() => db.close());

  it.each(['EXAM', 'CONTINUOUS_ASSESSMENT'] as const)('solo exige nota a la destinataria de una prueba %s y conserva la selección', kind => {
    const [martina, alba] = db.listStudents('ESO_3');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Català' });
    const column = db.addAssessment(sheet.id, kind, 'Prueba individual', '2026-09-10', [martina.id]).columns[0];
    expect(db.getWorksheet(sheet.id).isComplete).toBe(false);
    expect(db.getWorksheet(sheet.id).applicability[`${alba.id}:${column.id}`]).toBe('NOT_APPLICABLE');
    expect(() => db.saveCell(sheet.id, alba.id, column.id, 'grade', '0')).toThrow('NOT_APPLICABLE_GRADE');
    db.saveCell(sheet.id, martina.id, column.id, 'grade', '8');
    expect(db.getWorksheet(sheet.id).isComplete).toBe(true);
    db.updateAssessment(column.id, { kind, name: 'Individual editada', assessmentDate: '2026-09-11' });
    expect(db.getWorksheet(sheet.id).columns[0].studentIds).toEqual([martina.id]);
    const output = buildExport(db, sheet.id);
    expect(output.version).toBe(2);
    expect(output.columns[0].isIndividual).toBe(true);
    expect(validateImport(output).ok).toBe(true);
    const copy = db.copyWorksheet(sheet.id, 'T_2');
    const copied = db.getWorksheet(copy.id);
    expect(copied.columns[0].studentIds).toEqual([martina.id]);
    expect(copied.applicability[`${alba.id}:${copied.columns[0].id}`]).toBe('NOT_APPLICABLE');
    expect(copied.applicability[`${martina.id}:${copied.columns[0].id}`]).toBe('UNRESOLVED');
    const restored = db.restoreWorksheet(output, true);
    expect(db.getWorksheet(restored.id).columns[0].studentIds).toEqual([martina.id]);
    expect(db.getWorksheet(restored.id).isComplete).toBe(true);
    expect(buildExport(db, restored.id).columns[0].isIndividual).toBe(true);
  });

  it('valida destinatarios y permite convertir la prueba en una evaluación para todos', () => {
    const [martina, alba] = db.listStudents('ESO_3');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Català' });
    expect(() => db.addAssessment(sheet.id, 'EXAM', 'Sin alumnos', '2026-09-10', [])).toThrow('INDIVIDUAL_STUDENTS_REQUIRED');
    expect(() => db.addAssessment(sheet.id, 'EXAM', 'Inválida', '2026-09-10', [99999])).toThrow('INVALID_ASSESSMENT_STUDENTS');
    expect(db.getWorksheet(sheet.id).columns).toHaveLength(0);
    const column = db.addAssessment(sheet.id, 'EXAM', 'Individual', '2026-09-10', [martina.id]).columns[0];
    db.updateAssessment(column.id, { kind: 'EXAM', name: 'Todos', assessmentDate: '2026-09-10', studentIds: null });
    expect(db.getWorksheet(sheet.id).columns[0].studentIds).toBeUndefined();
    expect(db.getWorksheet(sheet.id).applicability[`${alba.id}:${column.id}`]).toBe('APPLICABLE');
  });

  it('mantiene las pruebas comunes y oculta la prueba exclusiva tras importar la entrega al tutor', () => {
    const [martina, alba] = db.listStudents('ESO_3');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Català' });
    const common = db.addAssessment(sheet.id, 'EXAM', 'Examen común', '2026-09-10').columns[0];
    for (const student of [martina, alba]) db.saveCell(sheet.id, student.id, common.id, 'grade', '7');
    const exclusive = db.addAssessment(sheet.id, 'CONTINUOUS_ASSESSMENT', 'Solo Martina', '2026-09-11', [martina.id]).columns[1];
    db.saveCell(sheet.id, martina.id, exclusive.id, 'grade', '9');
    db.saveCell(sheet.id, martina.id, exclusive.id, 'observation', 'Comentario privado de la prueba');
    const output = buildExport(db, sheet.id);
    db.saveImport(output, false);
    const report = buildTrackingReports(db, db.listTrackingReports()[0].id);
    const martinaIndex = report.students.findIndex(student => student.name === martina.fullName);
    const albaIndex = report.students.findIndex(student => student.name === alba.fullName);
    expect(buildStudentReportHtml(report, martinaIndex)).toContain('Solo Martina');
    const html = buildStudentReportHtml(report, albaIndex);
    expect(html).toContain('Examen común');
    expect(html).not.toContain('Solo Martina');
    expect(html).not.toContain('Comentario privado de la prueba');
    expect(html).not.toContain('N/A');
  });
});

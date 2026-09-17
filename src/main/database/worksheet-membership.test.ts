import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CENTER_CONFIGURATION, DEFAULT_GRADE_CONVERSION } from '../../shared/center/center-configuration';
import { buildExport } from '../export/export-service';
import { validateImport } from '../import/validation';
import { AppDatabase } from './database';

const courses = [{ name: '1r ESO', subjects: ['Català', 'Optativa'], students: ['Aina Bosch', 'Biel Casas'] }];
const roster = (names: string[]) => [{ name: '1r ESO', students: names }];

describe('hojas con altas y bajas', () => {
  let db: AppDatabase;
  beforeEach(() => {
    db = new AppDatabase(':memory:');
    db.replaceCenterData(courses, { ...DEFAULT_CENTER_CONFIGURATION, notEvaluatedValue: 'NP', grades: [...DEFAULT_GRADE_CONVERSION], gradesExplanation: { NA: 'No assolit', AS: 'Assoliment satisfactori', AN: 'Assoliment notable', AE: 'Assoliment excel·lent', NP: 'No presentat' }, hasLetterGrades: true, finalReportGradeMode: 'LETTER' });
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
  });
  afterEach(() => db.close());

  const apply = (names: string[], date: string, assignments: Array<{ courseId: 'ESO_1'; incomingName: string; studentId: number | null }> = []) => {
    const input = roster(names);
    db.applyCenterRoster(input, date, assignments, db.analyzeCenterRoster(input).revision);
  };

  it('marca como no aplicable un examen anterior al alta, sin convertirlo en NP ni suspenso', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, exam.id, 'grade', '7');
    db.saveCell(sheet.id, biel.id, exam.id, 'grade', 'NP');
    apply(['Aina Bosch', 'Biel Casas', 'Carla Costa'], '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }]);
    const carla = db.listActiveStudents('ESO_1')[2];
    const detail = db.getWorksheet(sheet.id);
    expect(detail.applicability[`${carla.id}:${exam.id}`]).toBe('NOT_APPLICABLE');
    expect(detail.values[`${carla.id}:${exam.id}`]).toBeUndefined();
    expect(detail.values[`${biel.id}:${exam.id}`]).toBe('NP');
    expect(detail.isComplete).toBe(true);
    expect(() => db.saveCell(sheet.id, carla.id, exam.id, 'grade', '0')).toThrow('NOT_APPLICABLE_GRADE');
    const output = buildExport(db, sheet.id);
    expect(output.version).toBe(2);
    expect(output.students.find(student => student.name === 'Carla Costa')).toMatchObject({ enrolled: true, values: { [exam.exportId]: '' }, applicability: { [exam.exportId]: 'NOT_APPLICABLE' } });
    expect(output.students.find(student => student.name === 'Biel Casas')).toMatchObject({ values: { [exam.exportId]: 'NP' }, applicability: { [exam.exportId]: 'APPLICABLE' } });
    expect(JSON.stringify(output)).not.toContain(`"studentId":${carla.id}`);
    expect(validateImport(output).ok).toBe(true);
    output.exportedAt = '2026-09-21T10:00:00.000Z';
    db.saveImport(output, false);
    expect(db.listImports()[0]).toMatchObject({ isStale: false, gradedStudentNames: ['Aina Bosch', 'Biel Casas', 'Carla Costa'] });
  });

  it('conserva notas anteriores a la baja y no exige nota después de ella', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const oldExam = db.addAssessment(sheet.id, 'EXAM', 'Inicial', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, oldExam.id, 'grade', '8');
    db.saveCell(sheet.id, biel.id, oldExam.id, 'grade', '6');
    apply(['Aina Bosch'], '2026-09-20');
    const later = db.addAssessment(sheet.id, 'EXAM', 'Posterior', '2026-09-25').columns[1];
    db.saveCell(sheet.id, aina.id, later.id, 'grade', '7');
    const detail = db.getWorksheet(sheet.id);
    expect(detail.activeStudentIds).toEqual([aina.id]);
    expect(detail.students.map(student => student.id)).toContain(biel.id);
    expect(detail.values[`${biel.id}:${oldExam.id}`]).toBe('6');
    expect(detail.applicability[`${biel.id}:${oldExam.id}`]).toBe('APPLICABLE');
    expect(detail.applicability[`${biel.id}:${later.id}`]).toBe('NOT_APPLICABLE');
    expect(detail.isComplete).toBe(true);
    expect(buildExport(db, sheet.id).students.find(student => student.name === 'Biel Casas')).toMatchObject({ enrolled: false, applicability: { [later.exportId]: 'NOT_APPLICABLE' } });
  });

  it('reaplica la regla durante un regreso sin rellenar el intervalo de baja', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    apply(['Aina Bosch'], '2026-09-20');
    const gap = db.addAssessment(sheet.id, 'EXAM', 'Durante baja', '2026-09-25').columns[0];
    apply(['Aina Bosch', 'Biel Casas'], '2026-10-01', [{ courseId: 'ESO_1', incomingName: 'Biel Casas', studentId: biel.id }]);
    const after = db.addAssessment(sheet.id, 'EXAM', 'Tras regreso', '2026-10-05').columns[1];
    db.saveCell(sheet.id, aina.id, gap.id, 'grade', '7');
    db.saveCell(sheet.id, aina.id, after.id, 'grade', '8');
    expect(db.getWorksheet(sheet.id).applicability[`${biel.id}:${gap.id}`]).toBe('NOT_APPLICABLE');
    expect(db.getWorksheet(sheet.id).applicability[`${biel.id}:${after.id}`]).toBe('APPLICABLE');
    expect(db.getWorksheet(sheet.id).isComplete).toBe(false);
    db.saveCell(sheet.id, biel.id, after.id, 'grade', '5');
    expect(db.getWorksheet(sheet.id).isComplete).toBe(true);
  });

  it('respeta optativas y deja una copia sin fecha sin estado automático', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Optativa', isElective: true });
    db.configureElectiveStudents(sheet.id, [aina.id]);
    const old = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, old.id, 'grade', '8');
    apply(['Aina Bosch', 'Biel Casas', 'Carla Costa'], '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }]);
    const carla = db.listActiveStudents('ESO_1')[2];
    db.configureElectiveStudents(sheet.id, [aina.id, carla.id]);
    expect(db.getWorksheet(sheet.id).applicability[`${biel.id}:${old.id}`]).toBe('NOT_APPLICABLE');
    expect(db.getWorksheet(sheet.id).applicability[`${carla.id}:${old.id}`]).toBe('NOT_APPLICABLE');
    expect(db.getWorksheet(sheet.id).isComplete).toBe(true);
    const copy = db.copyWorksheet(sheet.id, 'T_2');
    const copiedColumn = db.getWorksheet(copy.id).columns[0];
    expect(db.getWorksheet(copy.id).applicability[`${aina.id}:${copiedColumn.id}`]).toBe('UNRESOLVED');
    expect(db.getWorksheet(copy.id).isComplete).toBe(false);
    expect(() => buildExport(db, copy.id)).toThrow('INCOMPLETE_WORKSHEET');
    db.updateAssessment(copiedColumn.id, { kind: 'EXAM', name: 'Prova', assessmentDate: '2026-09-10' });
    expect(db.getWorksheet(copy.id).applicability[`${carla.id}:${copiedColumn.id}`]).toBe('NOT_APPLICABLE');
    db.saveCell(copy.id, aina.id, copiedColumn.id, 'grade', '7');
    expect(db.getWorksheet(copy.id).isComplete).toBe(true);
  });

  it('valida notas de letras solo en celdas aplicables y mantiene NP separado', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català', gradeMode: 'LETTER' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    apply(['Aina Bosch', 'Biel Casas', 'Carla Costa'], '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }]);
    db.saveCell(sheet.id, aina.id, exam.id, 'grade', 'AS');
    db.saveCell(sheet.id, biel.id, exam.id, 'grade', 'NP');
    expect(() => db.saveCell(sheet.id, aina.id, exam.id, 'grade', 'ZZ')).toThrow('INVALID_GRADE_VALUE');
    expect(db.getWorksheet(sheet.id).isComplete).toBe(true);
    const output = buildExport(db, sheet.id);
    expect(output.students.find(student => student.name === 'Biel Casas')?.values[exam.exportId]).toBe('NP');
    expect(output.students.find(student => student.name === 'Carla Costa')?.applicability?.[exam.exportId]).toBe('NOT_APPLICABLE');
  });

  it('restaura v2 en otra base sin reinterpretar la aplicabilidad por sus fechas locales', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, exam.id, 'grade', '7');
    db.saveCell(sheet.id, biel.id, exam.id, 'grade', '8');
    apply(['Aina Bosch', 'Biel Casas', 'Carla Costa'], '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }]);
    const file = buildExport(db, sheet.id);
    const target = new AppDatabase(':memory:');
    try {
      target.replaceCenterData([{ ...courses[0], students: ['Aina Bosch', 'Biel Casas', 'Carla Costa'] }], db.getCenterConfiguration());
      const restored = target.restoreWorksheet(file, false);
      const carla = target.listStudents('ESO_1').find(student => student.fullName === 'Carla Costa')!;
      const localColumn = target.getWorksheet(restored.id).columns[0];
      expect(target.getWorksheet(restored.id).applicability[`${carla.id}:${localColumn.id}`]).toBe('NOT_APPLICABLE');
      expect(target.getWorksheet(restored.id).isComplete).toBe(true);
    } finally { target.close(); }
  });

  it('no exporta homónimos históricos con una identidad de nombre ambigua', () => {
    const [aina, biel] = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, exam.id, 'grade', '7');
    db.saveCell(sheet.id, biel.id, exam.id, 'grade', '8');
    apply(['Biel Casas'], '2026-09-20');
    apply(['Biel Casas', 'Aina Bosch'], '2026-10-01', [{ courseId: 'ESO_1', incomingName: 'Aina Bosch', studentId: null }]);
    expect(db.getWorksheet(sheet.id).isComplete).toBe(true);
    expect(() => buildExport(db, sheet.id)).toThrow('AMBIGUOUS_STUDENT_NAMES');
  });
});

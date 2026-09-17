import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCenterFile } from '../import/catalog-parser';
import { AppDatabase } from './database';
import type { FullSeguimentExport } from '../../shared/types/models';

// Versioned fixture matching the two example imports: the copy adds Carla to 1r ESO.
const example = {
  assessmentWeights: { exam: 70, continuousAssessment: 30 }, finalReportGradeMode: 'LETTER', notEvaluated: 'NP',
  gradesExplanation: { NA: 'No assolit', AS: 'Assoliment satisfactori', AN: 'Assoliment notable', AE: 'Assoliment excel·lent', NP: 'No presentat' },
  grades: [
    { grade: 'NA-', from: 0 }, { grade: 'NA', from: 3 }, { grade: 'NA+', from: 4 },
    { grade: 'AS-', from: 5 }, { grade: 'AS', from: 5.5 }, { grade: 'AS+', from: 6.5 },
    { grade: 'AN-', from: 7 }, { grade: 'AN', from: 7.5 }, { grade: 'AN+', from: 8.5 },
    { grade: 'AE-', from: 9 }, { grade: 'AE', from: 9.5 }, { grade: 'AE+', from: 9.8 }
  ],
  courses: [
    { name: '1r ESO', subjects: ['Català', 'Anglès', 'Optativa 1', 'Optativa 2'], students: ['Aina Bosch', 'Biel Casas'] },
    { name: '2n ESO', subjects: ['Català', 'Anglès', 'Optativa'], students: ['Carla Costa', 'David Duran'] },
    { name: '3r ESO', subjects: ['Català', 'Anglès', 'Optativa'], students: ['Emma Esteve', 'Ferran Ferrer'] },
    { name: '4t ESO', subjects: ['Català', 'Anglès', 'Optativa'], students: ['Gina Font', 'Hugo Garcia'] }
  ]
};
const loadCenter = (addCarla = false) => {
  const fixture = structuredClone(example);
  if (addCarla) fixture.courses[0].students.push('Carla Costa');
  const parsed = parseCenterFile(JSON.stringify(fixture), '.json');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
};

describe('actualización segura del centro', () => {
  let db: AppDatabase;
  const original = loadCenter();
  const withNewStudent = loadCenter(true);

  beforeEach(() => { db = new AppDatabase(':memory:'); db.replaceCenterData(original.courses, original.centerConfiguration); });
  afterEach(() => db.close());

  const addHistory = () => {
    const students = db.listStudents('ESO_1');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const column = db.addAssessment(sheet.id, 'EXAM', 'Lectura', '2026-09-12').columns[0];
    db.saveCell(sheet.id, students[0].id, column.id, 'grade', '8');
    db.saveCell(sheet.id, students[0].id, column.id, 'observation', 'Bon treball');
    const delivery: FullSeguimentExport = {
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-16T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: 'Català', gradeMode: 'NUMERIC' },
      columns: [{ id: 'exam-1', name: 'Lectura', kind: 'EXAM', assessmentDate: '2026-09-12' }],
      students: students.map(student => ({ name: student.fullName, values: { 'exam-1': '8' } }))
    };
    db.saveImport(delivery, false);
    const report = db.listTrackingReports()[0];
    db.saveTutorObservation(report.id, students[0].id, 'Continua així');
    return { students, sheet, column, report };
  };

  it('reimporta el mismo archivo sin alterar IDs ni historial', () => {
    const { students, sheet, column, report } = addHistory();
    const before = db.getInitialState();
    const beforeWorksheet = db.getWorksheet(sheet.id);
    const beforeImports = db.listImports(report.id);
    db.replaceCenterData(original.courses, original.centerConfiguration);
    expect(db.getInitialState()).toEqual(before);
    expect(db.getWorksheet(sheet.id)).toEqual(beforeWorksheet);
    expect(db.listImports(report.id)).toEqual(beforeImports);
    expect(db.listStudents('ESO_1').map(student => student.id)).toEqual(students.map(student => student.id));
    expect(db.listSubjects('ESO_1').map(subject => subject.name)).toEqual(original.courses[0].subjects);
    expect(db.getWorksheet(sheet.id).columns[0].id).toBe(column.id);
    expect(db.getWorksheet(sheet.id).values[`${students[0].id}:${column.id}`]).toBe('8');
    expect(db.getWorksheet(sheet.id).observations[`${students[0].id}:${column.id}`]).toBe('Bon treball');
    expect(db.listImports(report.id)).toHaveLength(1);
    expect(db.listTrackingReports().map(item => item.id)).toEqual([report.id]);
    expect(db.listTutorObservations()[`${report.id}:${students[0].id}`]).toBe('Continua així');
  });

  it('rechaza el archivo con Carla añadida sin modificar nada', () => {
    const { students, sheet, column, report } = addHistory();
    expect(() => db.replaceCenterData(withNewStudent.courses, withNewStudent.centerConfiguration)).toThrow(/Carla Costa/);
    expect(db.listStudents('ESO_1').map(student => student.id)).toEqual(students.map(student => student.id));
    expect(db.getWorksheet(sheet.id).values[`${students[0].id}:${column.id}`]).toBe('8');
    expect(db.listImports(report.id)).toHaveLength(1);
  });

  it('conserva asignaturas existentes aunque falten en el archivo actualizado', () => {
    const courses = structuredClone(original.courses);
    courses[0].subjects = ['Anglès'];
    db.replaceCenterData(courses, original.centerConfiguration);
    expect(db.listSubjects('ESO_1').map(subject => subject.name)).toContain('Català');
  });

  it('añade asignaturas nuevas sin cambiar el orden de las existentes', () => {
    const before = db.listSubjects('ESO_1');
    const courses = structuredClone(original.courses);
    courses[0].subjects.push('Música');
    db.replaceCenterData(courses, original.centerConfiguration);
    expect(db.listSubjects('ESO_1').slice(0, before.length)).toEqual(before);
    expect(db.listSubjects('ESO_1').at(-1)?.name).toBe('Música');
  });

  it('rechaza altas y bajas conjuntamente y conserva las notas', () => {
    const { students, sheet, column } = addHistory();
    const courses = structuredClone(withNewStudent.courses);
    courses[0].students = ['Aina Bosch', 'Carla Costa'];
    expect(() => db.replaceCenterData(courses, original.centerConfiguration)).toThrow(/Biel Casas.*Carla Costa|Carla Costa.*Biel Casas/);
    expect(db.listStudents('ESO_1').map(student => student.id)).toEqual(students.map(student => student.id));
    expect(db.getWorksheet(sheet.id).values[`${students[0].id}:${column.id}`]).toBe('8');
  });

  it('rechaza cambios parciales aunque otro curso del archivo sea válido', () => {
    const courses = structuredClone(withNewStudent.courses);
    courses[0].subjects.push('Música');
    expect(() => db.replaceCenterData(courses, original.centerConfiguration)).toThrow(/Carla Costa/);
    expect(db.listSubjects('ESO_1').some(subject => subject.name === 'Música')).toBe(false);
    expect(db.listStudents('ESO_1').map(student => student.fullName)).toEqual(['Aina Bosch', 'Biel Casas']);
  });

  it('impide borrar manualmente a un alumno con historial', () => {
    const { students, sheet, column, report } = addHistory();
    expect(() => db.deleteStudent(students[0].id)).toThrow();
    expect(db.getWorksheet(sheet.id).values[`${students[0].id}:${column.id}`]).toBe('8');
    expect(db.listTutorObservations()[`${report.id}:${students[0].id}`]).toBe('Continua així');
  });

  it('impide borrar a un alumno sin nota propia si su curso tiene historial', () => {
    const { students } = addHistory();
    expect(() => db.deleteStudent(students[1].id)).toThrow();
    expect(db.listStudents('ESO_1')).toHaveLength(2);
  });

  it('permite borrar manualmente a un alumno sin historial', () => {
    const student = db.listStudents('ESO_1')[0];
    db.deleteStudent(student.id);
    expect(db.listStudents('ESO_1').some(item => item.id === student.id)).toBe(false);
  });

  it('impide sustituir un listado si ello borra notas', () => {
    const { students, sheet, column } = addHistory();
    expect(() => db.replaceCourseRoster('ESO_1', ['Biel Casas'])).toThrow();
    expect(db.listStudents('ESO_1').map(student => student.id)).toEqual(students.map(student => student.id));
    expect(db.getWorksheet(sheet.id).values[`${students[0].id}:${column.id}`]).toBe('8');
  });

  it('impide reinterpretar informes existentes con otra configuración de notas', () => {
    addHistory();
    const changed = { ...original.centerConfiguration, examWeight: 60, continuousAssessmentWeight: 40 };
    expect(() => db.replaceCenterData(original.courses, changed)).toThrow();
    expect(db.getCenterConfiguration()).toEqual(original.centerConfiguration);
  });

  it('revierte también asignaturas nuevas si falla la configuración de notas', () => {
    addHistory();
    const courses = structuredClone(original.courses);
    courses[0].subjects.push('Música');
    const changed = { ...original.centerConfiguration, finalReportGradeMode: 'NUMERIC' as const };
    expect(() => db.replaceCenterData(courses, changed)).toThrow(/configuración de notas/);
    expect(db.listSubjects('ESO_1').some(subject => subject.name === 'Música')).toBe(false);
    expect(db.getCenterConfiguration()).toEqual(original.centerConfiguration);
  });

  it('permite cambiar la configuración antes del primer informe', () => {
    const changed = { ...original.centerConfiguration, examWeight: 60, continuousAssessmentWeight: 40 };
    db.replaceCenterData(original.courses, changed);
    expect(db.getCenterConfiguration().examWeight).toBe(60);
  });

  it('mantiene separado el borrado explícito de la importación', () => {
    addHistory();
    db.clearCenterData();
    expect(db.listStudents()).toEqual([]);
    expect(db.listWorksheets()).toEqual([]);
    expect(db.listTrackingReports()).toEqual([]);
    expect(db.listSubjects()).toEqual([]);
  });
});

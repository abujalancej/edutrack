import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CENTER_CONFIGURATION } from '../../shared/center/center-configuration';
import { parseCenterFile } from '../import/catalog-parser';
import { AppDatabase, type RosterAssignment } from './database';

const official = [
  { name: '1r ESO', subjects: ['Català'], students: ['Aina Bosch', 'Biel Casas'] },
  { name: '2n ESO', subjects: ['Català'], students: ['Carla Costa'] }
];
const roster = (first: string[], second: string[] = ['Carla Costa']) => [
  { name: '1r ESO', students: first }, { name: '2n ESO', students: second }
];

describe('historial de pertenencia al curso', () => {
  let db: AppDatabase;
  beforeEach(() => { db = new AppDatabase(':memory:'); db.replaceCenterData(official, DEFAULT_CENTER_CONFIGURATION); });
  afterEach(() => db.close());

  it('analiza altas y bajas sin escribir y señala posibles renombres sin emparejarlos', () => {
    const before = db.getInitialState();
    const periods = db.listStudentEnrollments();
    const result = db.analyzeCenterRoster(roster(['Aina Bosch', 'Biel Casas', 'Noa Noguera']));
    expect(result.courses[0].status).toBe('changed');
    expect(result.courses[0].added).toEqual(['Noa Noguera']);
    expect(result.courses[0].removed).toEqual([]);
    expect(result.courses[0].possibleNameChanges).toBeNull();
    expect(result.courses[1].status).toBe('unchanged');
    expect(db.getInitialState()).toEqual(before);
    expect(db.listStudentEnrollments()).toEqual(periods);
  });

  it('da de baja sin borrar ID, nota ni observación', () => {
    const biel = db.listStudents('ESO_1')[1];
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const column = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, biel.id, column.id, 'grade', '7');
    db.saveCell(sheet.id, biel.id, column.id, 'observation', 'Progrés');
    const input = roster(['Aina Bosch']);
    const analysis = db.analyzeCenterRoster(input);
    expect(analysis.courses[0].removed).toEqual([{ id: biel.id, name: biel.fullName }]);
    db.applyCenterRoster(input, '2026-09-20', [], analysis.revision);
    expect(db.listStudents('ESO_1').some(student => student.id === biel.id)).toBe(true);
    expect(db.listActiveStudents('ESO_1').map(student => student.fullName)).toEqual(['Aina Bosch']);
    expect(db.listStudentEnrollments(biel.id)).toMatchObject([{ studentId: biel.id, startedOn: null, endedOn: '2026-09-20' }]);
    expect(db.getWorksheet(sheet.id).values[`${biel.id}:${column.id}`]).toBe('7');
    expect(db.getWorksheet(sheet.id).observations[`${biel.id}:${column.id}`]).toBe('Progrés');
    expect(() => db.deleteStudent(biel.id)).toThrow();
  });

  it('mantiene la baja histórica al reimportar el listado activo sin cambios', () => {
    const leaving = roster(['Aina Bosch']);
    const biel = db.listStudents('ESO_1')[1];
    db.applyCenterRoster(leaving, '2026-09-20', [], db.analyzeCenterRoster(leaving).revision);
    const center = structuredClone(official);
    center[0].students = ['Aina Bosch'];
    db.replaceCenterData(center, DEFAULT_CENTER_CONFIGURATION);
    expect(db.listStudentEnrollments(biel.id)).toMatchObject([{ startedOn: null, endedOn: '2026-09-20' }]);
    expect(db.listActiveStudents('ESO_1').map(student => student.fullName)).toEqual(['Aina Bosch']);
  });

  it('solo reutiliza el ID de quien vuelve con una confirmación explícita', () => {
    const biel = db.listStudents('ESO_1')[1];
    const leaving = roster(['Aina Bosch']);
    db.applyCenterRoster(leaving, '2026-09-20', [], db.analyzeCenterRoster(leaving).revision);
    const returning = roster(['Aina Bosch', 'Biel Casas']);
    const analysis = db.analyzeCenterRoster(returning);
    expect(analysis.courses[0].added).toEqual(['Biel Casas']);
    expect(analysis.courses[0].ambiguousMatches[0].candidates).toEqual([{ id: biel.id, name: 'Biel Casas' }]);
    expect(() => db.applyCenterRoster(returning, '2026-10-01', [], analysis.revision)).toThrow(/confirmar/);
    db.applyCenterRoster(returning, '2026-10-01', [{ courseId: 'ESO_1', incomingName: 'Biel Casas', studentId: biel.id }], analysis.revision);
    expect(db.listActiveStudents('ESO_1').map(student => student.id)).toContain(biel.id);
    expect(db.listStudentEnrollments(biel.id)).toMatchObject([
      { startedOn: null, endedOn: '2026-09-20' },
      { startedOn: '2026-10-01', endedOn: null }
    ]);
  });

  it('renombra por asignación manual al ID y conserva las notas', () => {
    const aina = db.listStudents('ESO_1')[0];
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const column = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, aina.id, column.id, 'grade', '9');
    const input = roster(['Aina Maria Bosch', 'Biel Casas']);
    const analysis = db.analyzeCenterRoster(input);
    expect(analysis.courses[0].possibleNameChanges).toEqual({ existing: [{ id: aina.id, name: 'Aina Bosch' }], incoming: ['Aina Maria Bosch'] });
    db.applyCenterRoster(input, '2026-09-22', [{ courseId: 'ESO_1', incomingName: 'Aina Maria Bosch', studentId: aina.id }], analysis.revision);
    expect(db.listActiveStudents('ESO_1')[0]).toMatchObject({ id: aina.id, fullName: 'Aina Maria Bosch' });
    expect(db.listStudentEnrollments(aina.id)).toMatchObject([{ startedOn: null, endedOn: null }]);
    expect(db.getWorksheet(sheet.id).values[`${aina.id}:${column.id}`]).toBe('9');
  });

  it('crea otra identidad para un homónimo confirmado y nunca une alumnos de cursos distintos', () => {
    const oldBiel = db.listStudents('ESO_1')[1];
    const leaving = roster(['Aina Bosch']);
    db.applyCenterRoster(leaving, '2026-09-20', [], db.analyzeCenterRoster(leaving).revision);
    const sameName = roster(['Aina Bosch', 'Biel Casas'], ['Carla Costa', 'Aina Bosch']);
    const analysis = db.analyzeCenterRoster(sameName);
    const assignments: RosterAssignment[] = [
      { courseId: 'ESO_1', incomingName: 'Biel Casas', studentId: null },
      { courseId: 'ESO_2', incomingName: 'Aina Bosch', studentId: null }
    ];
    db.applyCenterRoster(sameName, '2026-10-01', assignments, analysis.revision);
    const newBiel = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Biel Casas')!;
    expect(newBiel.id).not.toBe(oldBiel.id);
    expect(db.listStudentEnrollments(oldBiel.id)[0].endedOn).toBe('2026-09-20');
    const aina1 = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Aina Bosch')!;
    const aina2 = db.listActiveStudents('ESO_2').find(student => student.fullName === 'Aina Bosch')!;
    expect(aina1.id).not.toBe(aina2.id);
    expect(db.listStudentEnrollments(aina2.id)[0].startedOn).toBe('2026-10-01');
  });

  it('registra un traslado con otro ID local y deja intacta la nota del curso anterior', () => {
    const biel = db.listStudents('ESO_1')[1];
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
    const column = db.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
    db.saveCell(sheet.id, biel.id, column.id, 'grade', '6');
    const input = roster(['Aina Bosch'], ['Carla Costa', 'Biel Casas']);
    const analysis = db.analyzeCenterRoster(input);
    expect(analysis.courses[0].removed).toEqual([{ id: biel.id, name: 'Biel Casas' }]);
    expect(analysis.courses[1].added).toEqual(['Biel Casas']);
    expect(() => db.applyCenterRoster(input, '2026-09-25', [{ courseId: 'ESO_2', incomingName: 'Biel Casas', studentId: biel.id }], analysis.revision)).toThrow(/no pertenece/);
    db.applyCenterRoster(input, '2026-09-25', [{ courseId: 'ESO_2', incomingName: 'Biel Casas', studentId: null }], analysis.revision);
    const newBiel = db.listActiveStudents('ESO_2').find(student => student.fullName === 'Biel Casas')!;
    expect(newBiel.id).not.toBe(biel.id);
    expect(db.listStudentEnrollments(biel.id)[0].endedOn).toBe('2026-09-25');
    expect(db.getWorksheet(sheet.id).values[`${biel.id}:${column.id}`]).toBe('6');
  });

  it('rechaza duplicados dentro del curso, pero acepta el mismo nombre en cursos distintos', () => {
    expect(() => db.analyzeCenterRoster(roster(['Aina Bosch', 'aina bosch']))).toThrow(/duplicado/);
    expect(db.analyzeCenterRoster(roster(['Aina Bosch', 'Biel Casas'], ['Carla Costa', 'Aina Bosch'])).courses[1].added).toEqual(['Aina Bosch']);
    expect(parseCenterFile(JSON.stringify({ courses: [{ name: '1r ESO', subjects: ['Català'], students: ['Aina Bosch', 'Aina Bosch'] }] }), '.json').ok).toBe(false);
    expect(parseCenterFile('Curso;Asignaturas;Alumnos\n1r ESO;Català;Aina Bosch|Aina Bosch', '.csv').ok).toBe(false);
  });

  it('revierte toda la operación ante una asignación inválida en otro curso', () => {
    const input = roster(['Aina Bosch', 'Biel Casas', 'Noa Noguera'], ['Carla Costa', 'David Duran']);
    const analysis = db.analyzeCenterRoster(input);
    const beforeStudents = db.listStudents();
    const beforePeriods = db.listStudentEnrollments();
    expect(() => db.applyCenterRoster(input, '2026-09-25', [
      { courseId: 'ESO_1', incomingName: 'Noa Noguera', studentId: null },
      { courseId: 'ESO_2', incomingName: 'David Duran', studentId: beforeStudents[0].id }
    ], analysis.revision)).toThrow(/no pertenece/);
    expect(db.listStudents()).toEqual(beforeStudents);
    expect(db.listStudentEnrollments()).toEqual(beforePeriods);
  });

  it('revierte escrituras ya realizadas si falla una escritura posterior', () => {
    const raw = (db as unknown as { db: DatabaseSync }).db;
    raw.exec(`CREATE TRIGGER reject_david BEFORE INSERT ON students WHEN NEW.full_name = 'David Duran'
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
    const input = roster(['Aina Bosch', 'Biel Casas', 'Noa Noguera'], ['Carla Costa', 'David Duran']);
    const beforeStudents = db.listStudents();
    const beforePeriods = db.listStudentEnrollments();
    expect(() => db.applyCenterRoster(input, '2026-09-25', [
      { courseId: 'ESO_1', incomingName: 'Noa Noguera', studentId: null },
      { courseId: 'ESO_2', incomingName: 'David Duran', studentId: null }
    ], db.analyzeCenterRoster(input).revision)).toThrow(/injected failure/);
    expect(db.listStudents()).toEqual(beforeStudents);
    expect(db.listStudentEnrollments()).toEqual(beforePeriods);
  });

  it('rechaza análisis caducados y fechas incompatibles', () => {
    const input = roster(['Aina Bosch', 'Biel Casas', 'Noa Noguera']);
    const analysis = db.analyzeCenterRoster(input);
    db.addStudent('ESO_2', 'Eva Esteve');
    expect(() => db.applyCenterRoster(input, '2026-09-25', [{ courseId: 'ESO_1', incomingName: 'Noa Noguera', studentId: null }], analysis.revision)).toThrow(/vuelve a analizarlo/);
    expect(() => db.applyCenterRoster(input, '2026-02-30', [], db.analyzeCenterRoster(input).revision)).toThrow(/fecha efectiva/);
  });
});

describe('migración de alumnos anteriores', () => {
  it('mantiene IDs y notas y registra un inicio desconocido sin inventar fecha', () => {
    const directory = mkdtempSync(join(tmpdir(), 'edutrack-roster-'));
    const path = join(directory, 'legacy.sqlite');
    try {
      const before = new AppDatabase(path);
      before.replaceCenterData(official, DEFAULT_CENTER_CONFIGURATION);
      const student = before.listStudents('ESO_1')[0];
      const sheet = before.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català' });
      const column = before.addAssessment(sheet.id, 'EXAM', 'Prova', '2026-09-10').columns[0];
      before.saveCell(sheet.id, student.id, column.id, 'grade', '8');
      before.close();
      const legacy = new DatabaseSync(path);
      legacy.exec('DROP TRIGGER students_open_initial_enrollment; DROP TABLE student_enrollments');
      legacy.close();
      const migrated = new AppDatabase(path);
      try {
        expect(migrated.listStudents('ESO_1')[0].id).toBe(student.id);
        expect(migrated.listStudentEnrollments(student.id)).toMatchObject([{ startedOn: null, endedOn: null }]);
        expect(migrated.getWorksheet(sheet.id).values[`${student.id}:${column.id}`]).toBe('8');
      } finally { migrated.close(); }
      const reopened = new AppDatabase(path);
      try { expect(reopened.listStudentEnrollments(student.id)).toHaveLength(1); }
      finally { reopened.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

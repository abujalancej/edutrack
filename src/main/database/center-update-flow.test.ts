import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { centerUpdateChoiceKey, prepareCenterUpdateConfirmation } from '../../shared/center/center-update-confirmation';
import { buildExport } from '../export/export-service';
import { issueTrackingReport } from '../export/tracking-report-issue-service';
import { buildTrackingReports } from '../export/tracking-report-service';
import { parseCenterFile } from '../import/catalog-parser';
import { validateImport } from '../import/validation';
import { AppDatabase } from './database';

const example = (name: string) => readFileSync(join(process.cwd(), 'examples', name), 'utf8');
const initial = parseCenterFile(example('demo_01_school_initial_roster.json'), '.json');
const changed = parseCenterFile(example('demo_02_school_carla_joins_eso1.json'), '.json');
if (!initial.ok || !changed.ok) throw new Error('Los ejemplos del centro no son válidos.');
const official = initial;
const updated = changed;
const demoStage = (name: string) => {
  const parsed = parseCenterFile(example(name), '.json');
  if (!parsed.ok) throw new Error(`El ejemplo ${name} no es válido.`);
  return parsed;
};
const files = ['demo_01_Catala_v1.edutrack', 'demo_01_Angles_v1.edutrack', 'demo_01_Optativa-1_v1.edutrack', 'demo_01_Optativa-2_v1.edutrack'];
const currentFiles = ['demo_02_Catala_v2.edutrack', 'demo_02_Angles_v2.edutrack', 'demo_02_Optativa-1_v2.edutrack', 'demo_02_Optativa-2_v2.edutrack'];
const delivery = (filename: string) => {
  const parsed = validateImport(JSON.parse(example(filename)));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
};

describe('actualización completa del centro con los JSON de examples', () => {
  let db: AppDatabase;
  beforeEach(() => { db = new AppDatabase(':memory:'); db.replaceCenterData(official.courses, official.centerConfiguration); });
  afterEach(() => db.close());

  it('conserva informe 1 y sus notas, y emite informe 2 con Carla nueva en 1r ESO', async () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra', sex: 'FEMALE' });
    const [aina, biel] = db.listActiveStudents('ESO_1');
    const carlaInSecond = db.listActiveStudents('ESO_2').find(student => student.fullName === 'Carla Costa')!;
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Català', gradeMode: 'LETTER' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Lectura', '2026-09-07').columns[0];
    db.saveCell(sheet.id, aina.id, exam.id, 'grade', 'AS');
    db.saveCell(sheet.id, biel.id, exam.id, 'grade', 'AN');
    db.saveCell(sheet.id, aina.id, exam.id, 'observation', 'Nota original');
    files.forEach(filename => db.saveImport(delivery(filename), false));
    const first = db.listTrackingReports()[0];
    expect(db.listImports(first.id)).toHaveLength(4);
    expect(buildTrackingReports(db, first.id).students).toHaveLength(2);
    expect(await issueTrackingReport(db, first.id, async () => '/tmp', async () => 2)).toBe(2);
    const oldSnapshot = db.getReportSnapshot(first.id);
    const issued = buildTrackingReports(db, first.id);
    const preview = db.analyzeCenterUpdate(updated.courses, updated.centerConfiguration);
    expect(preview.courses[0].added).toEqual(['Carla Costa']);
    expect(preview.courses[1].unchanged.map(student => student.name)).toContain('Carla Costa');
    expect(preview.rosterChanged).toBe(true);
    db.applyCenterUpdate(updated.courses, updated.centerConfiguration, '2026-09-17', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], preview.revision);
    const carlaInFirst = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Carla Costa')!;
    expect(carlaInFirst.id).not.toBe(carlaInSecond.id);
    expect(db.getWorksheet(sheet.id).applicability[`${carlaInFirst.id}:${exam.id}`]).toBe('NOT_APPLICABLE');
    expect(db.getWorksheet(sheet.id).values[`${aina.id}:${exam.id}`]).toBe('AS');
    expect(db.getWorksheet(sheet.id).observations[`${aina.id}:${exam.id}`]).toBe('Nota original');
    expect(db.getReportSnapshot(first.id)).toEqual(oldSnapshot);
    expect(buildTrackingReports(db, first.id)).toEqual(issued);
    const second = db.copyTrackingReport(first.id);
    expect(db.listImports(second.id).every(item => item.isStale)).toBe(true);
    expect(() => buildTrackingReports(db, second.id)).toThrow(/Carla Costa/);
    expect(() => db.saveImport(delivery(files[0]), true)).toThrow(/Altas en el centro: Carla Costa/);
    const newCatalan = buildExport(db, sheet.id);
    expect(newCatalan.version).toBe(2);
    currentFiles.forEach(filename => db.saveImport(delivery(filename), true));
    expect(db.listImports(second.id).every(item => !item.isStale)).toBe(true);
    const secondData = buildTrackingReports(db, second.id);
    expect(secondData.students.map(student => student.name)).toEqual(['Aina Bosch', 'Biel Casas', 'Carla Costa']);
    expect(secondData.students[2].subjects.find(subject => subject.name === 'Català')?.applicability?.['col_65783041-0d5d-406a-8cb0-235bfa925cda']).toBe('NOT_APPLICABLE');
    expect(secondData.students[2].subjects.find(subject => subject.name === 'Català')?.values['demo-catala-17']).toBe('AS');
    expect(secondData.students[2].subjects.find(subject => subject.name === 'Optativa 2')?.values['demo-optativa2-17']).toBe('7');
    expect(await issueTrackingReport(db, second.id, async () => '/tmp', async () => 3)).toBe(3);
    expect(buildTrackingReports(db, first.id)).toEqual(issued);
    expect(db.getReportSnapshot(first.id)).toEqual(oldSnapshot);
  });

  it('cancelar la vista previa no escribe nada; aplicar dos veces el mismo archivo es idempotente', () => {
    const before = db.getInitialState();
    const beforeMembership = db.listStudentEnrollments();
    db.analyzeCenterUpdate(updated.courses, updated.centerConfiguration);
    expect(db.getInitialState()).toEqual(before);
    expect(db.listStudentEnrollments()).toEqual(beforeMembership);
    const preview = db.analyzeCenterUpdate(updated.courses, updated.centerConfiguration);
    db.applyCenterUpdate(updated.courses, updated.centerConfiguration, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], preview.revision);
    const after = db.getInitialState();
    const membership = db.listStudentEnrollments();
    for (let index = 0; index < 2; index += 1) {
      const repeat = db.analyzeCenterUpdate(updated.courses, updated.centerConfiguration);
      expect(repeat.rosterChanged).toBe(false);
      db.applyCenterUpdate(updated.courses, updated.centerConfiguration, null, [], repeat.revision);
    }
    expect(db.getInitialState()).toEqual(after);
    expect(db.listStudentEnrollments()).toEqual(membership);
  });

  it('rechaza los dos ficheros de demostración con listados incorrectos sin crear entregas', () => {
    expect(() => db.saveImport(delivery('demo_invalid_extra_student_v1.edutrack'), false)).toThrow(/Bajas o alumnos sin correspondencia: Carla Costa/);
    expect(() => db.saveImport(delivery('demo_invalid_missing_student_v1.edutrack'), false)).toThrow(/Altas en el centro: Biel Casas/);
    expect(db.listImports()).toEqual([]);
  });

  it('revierte cursos, asignaturas y alumnado si falla una asignación a mitad de la transacción', () => {
    const input = structuredClone(updated.courses);
    input[0].subjects.push('Música');
    const preview = db.analyzeCenterUpdate(input, updated.centerConfiguration);
    const before = db.getInitialState();
    expect(() => db.applyCenterUpdate(input, updated.centerConfiguration, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: 999999 }], preview.revision)).toThrow(/no pertenece/);
    expect(db.getInitialState()).toEqual(before);
    expect(db.listSubjects('ESO_1').some(subject => subject.name === 'Música')).toBe(false);
  });

  it('muestra asignaturas conservadas y renombres por resolver, sin emparejar nombres entre cursos', () => {
    const input = structuredClone(updated.courses);
    input[0].subjects = ['Català'];
    input[0].students = ['Aina Maria Bosch', 'Carla Costa'];
    const preview = db.analyzeCenterUpdate(input, updated.centerConfiguration);
    expect(preview.courses[0].omittedSubjects).toEqual(['Anglès', 'Optativa 1', 'Optativa 2']);
    expect(preview.courses[0].removed.map(student => student.name)).toEqual(['Aina Bosch', 'Biel Casas']);
    expect(preview.courses[0].possibleNameChanges?.incoming).toEqual(['Aina Maria Bosch', 'Carla Costa']);
    const aina = db.listStudents('ESO_1').find(student => student.fullName === 'Aina Bosch')!;
    db.applyCenterUpdate(input, updated.centerConfiguration, '2026-09-20', [
      { courseId: 'ESO_1', incomingName: 'Aina Maria Bosch', studentId: aina.id },
      { courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }
    ], preview.revision);
    expect(db.listActiveStudents('ESO_1').find(student => student.fullName === 'Aina Maria Bosch')?.id).toBe(aina.id);
    expect(db.listSubjects('ESO_1').map(subject => subject.name)).toContain('Anglès');
    expect(db.listStudents('ESO_1').some(student => student.fullName === 'Biel Casas')).toBe(true);
    expect(db.listActiveStudents('ESO_1').find(student => student.fullName === 'Carla Costa')?.id).not.toBe(db.listActiveStudents('ESO_2').find(student => student.fullName === 'Carla Costa')?.id);
  });

  it('rechaza nombres duplicados y una vista previa obsoleta sin escrituras parciales', () => {
    const duplicated = structuredClone(updated.courses);
    duplicated[0].students.push('Aina Bosch');
    expect(() => db.analyzeCenterUpdate(duplicated, updated.centerConfiguration)).toThrow(/duplicado/);
    const preview = db.analyzeCenterUpdate(updated.courses, updated.centerConfiguration);
    db.saveLanguage('ca');
    db.addStudent('ESO_3', 'Iris Isern');
    const before = db.getInitialState();
    expect(() => db.applyCenterUpdate(updated.courses, updated.centerConfiguration, '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }], preview.revision)).toThrow(/vista previa/);
    expect(db.getInitialState()).toEqual(before);
  });

  it('impide confirmar fechas inválidas, homónimos sin resolver y asignaciones duplicadas', () => {
    const input = structuredClone(updated.courses);
    input[0].students = ['Aina Maria Bosch', 'Carla Costa'];
    const preview = db.analyzeCenterUpdate(input, updated.centerConfiguration);
    expect(prepareCenterUpdateConfirmation(preview, {}, '').canConfirm).toBe(false);
    const oldAina = db.listStudents('ESO_1')[0];
    const choices = {
      [centerUpdateChoiceKey('ESO_1', 'Aina Maria Bosch')]: String(oldAina.id),
      [centerUpdateChoiceKey('ESO_1', 'Carla Costa')]: String(oldAina.id)
    };
    expect(prepareCenterUpdateConfirmation(preview, choices, '2026-09-20').duplicateAssignment).toBe(true);
    expect(prepareCenterUpdateConfirmation(preview, choices, '2026-09-20').canConfirm).toBe(false);
    choices[centerUpdateChoiceKey('ESO_1', 'Carla Costa')] = 'new';
    expect(prepareCenterUpdateConfirmation(preview, choices, '2026-02-30').canConfirm).toBe(false);
    expect(prepareCenterUpdateConfirmation(preview, choices, '2026-09-20').canConfirm).toBe(true);
    const ambiguous = structuredClone(preview);
    ambiguous.courses[0].ambiguousMatches.push({ name: 'Carla Costa', candidates: [{ id: oldAina.id, name: oldAina.fullName }] });
    expect(prepareCenterUpdateConfirmation(ambiguous, {}, '2026-09-20').canConfirm).toBe(false);
    expect(prepareCenterUpdateConfirmation(ambiguous, { [centerUpdateChoiceKey('ESO_1', 'Carla Costa')]: 'new' }, '2026-09-20').canConfirm).toBe(true);
  });

  it('añade un curso nuevo sin eliminar cursos omitidos ni vincular alumnos de otros cursos', () => {
    const input = [{ name: 'Bachillerato', subjects: ['Física'], students: ['Carla Costa'] }];
    const preview = db.analyzeCenterUpdate(input, official.centerConfiguration);
    expect(preview.courses[0].isNew).toBe(true);
    expect(preview.omittedCourses).toContain('1r ESO');
    const oldCarla = db.listStudents('ESO_2').find(student => student.fullName === 'Carla Costa')!;
    db.applyCenterUpdate(input, official.centerConfiguration, '2026-10-01', [{ courseId: preview.courses[0].courseId, incomingName: 'Carla Costa', studentId: null }], preview.revision);
    const newCarla = db.listActiveStudents(preview.courses[0].courseId)[0];
    expect(newCarla.id).not.toBe(oldCarla.id);
    expect(db.listCourses().map(course => course.name)).toContain('1r ESO');
    expect(db.listSubjects(preview.courses[0].courseId).map(subject => subject.name)).toEqual(['Física']);
  });

  it('reproduce las etapas de baja, regreso y renombre de la demo sin perder IDs ni catálogo', () => {
    const ainaId = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Aina Bosch')!.id;
    const bielId = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Biel Casas')!.id;
    const apply = (name: string, date: string, assignments: Array<{ courseId: 'ESO_1'; incomingName: string; studentId: number | null }>) => {
      const stage = demoStage(name);
      const preview = db.analyzeCenterUpdate(stage.courses, stage.centerConfiguration);
      db.applyCenterUpdate(stage.courses, stage.centerConfiguration, date, assignments, preview.revision);
      return preview;
    };
    apply('demo_02_school_carla_joins_eso1.json', '2026-09-17', [{ courseId: 'ESO_1', incomingName: 'Carla Costa', studentId: null }]);
    const carlaId = db.listActiveStudents('ESO_1').find(student => student.fullName === 'Carla Costa')!.id;
    const leave = apply('demo_03_school_biel_leaves_eso1.json', '2026-09-18', []);
    expect(leave.courses[0].removed.map(student => student.name)).toEqual(['Biel Casas']);
    expect(db.listActiveStudents('ESO_1').map(student => student.id)).not.toContain(bielId);
    expect(db.listStudents('ESO_1').map(student => student.id)).toContain(bielId);
    const returnPreview = apply('demo_04_school_biel_returns_eso1.json', '2026-09-19', [{ courseId: 'ESO_1', incomingName: 'Biel Casas', studentId: bielId }]);
    expect(returnPreview.courses[0].added).toEqual(['Biel Casas']);
    expect(db.listActiveStudents('ESO_1').find(student => student.fullName === 'Biel Casas')?.id).toBe(bielId);
    expect(db.listStudentEnrollments(bielId)).toHaveLength(2);
    const renamePreview = apply('demo_05_school_aina_renamed_subjects_changed_eso1.json', '2026-09-20', [{ courseId: 'ESO_1', incomingName: 'Aina Maria Bosch', studentId: ainaId }]);
    expect(renamePreview.courses[0].addedSubjects).toEqual(['Matemàtiques']);
    expect(renamePreview.courses[0].omittedSubjects).toEqual(['Optativa 1']);
    expect(db.listActiveStudents('ESO_1').find(student => student.fullName === 'Aina Maria Bosch')?.id).toBe(ainaId);
    expect(db.listActiveStudents('ESO_1').find(student => student.fullName === 'Carla Costa')?.id).toBe(carlaId);
    expect(db.listSubjects('ESO_1').map(subject => subject.name)).toContain('Optativa 1');
  });
});

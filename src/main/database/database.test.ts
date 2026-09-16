import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from './database';
import { buildExport, suggestedFilename } from '../export/export-service';
import { buildTrackingReports } from '../export/tracking-report-service';
import { COURSE_LABELS, COURSE_LEVELS, SUBJECTS_BY_COURSE } from '../../shared/catalogs/catalogs';
import { DEFAULT_CENTER_CONFIGURATION, DEFAULT_GRADE_CONVERSION } from '../../shared/center/center-configuration';
import type { FullSeguimentExport } from '../../shared/types/models';

describe('AppDatabase', () => {
  let db: AppDatabase;
  beforeEach(() => {
    db = new AppDatabase(':memory:');
    db.replaceCourses(COURSE_LEVELS.map(course => COURSE_LABELS[course]));
    db.replaceSubjectCatalog(COURSE_LEVELS.flatMap(course => SUBJECTS_BY_COURSE[course].map(subject => ({ course, subject }))));
  });
  afterEach(() => db.close());

  it('comparte el roster entre todas las hojas del curso y guarda celdas', () => {
    const anna = db.addStudent('ESO_2', 'Anna Pérez');
    const maths = db.createWorksheet({ courseLevel: 'ESO_2', trimester: 'T_1', subject: 'Matemàtiques' });
    const tech = db.createWorksheet({ courseLevel: 'ESO_2', trimester: 'T_2', subject: 'Tecnologia/Robòtica' });
    expect(db.getWorksheet(maths.id).students).toHaveLength(1);
    expect(db.getWorksheet(tech.id).students).toHaveLength(1);
    const detail = db.addAssessment(maths.id, 'EXAM', 'Examen 1', '2026-09-12');
    db.saveCell(maths.id, anna.id, detail.columns[0].id, 'grade', '7.5');
    db.saveCell(maths.id, anna.id, detail.columns[0].id, 'observation', 'Molt bona expressió escrita');
    expect(db.getWorksheet(maths.id).values[`${anna.id}:${detail.columns[0].id}`]).toBe('7.5');
    expect(db.getWorksheet(maths.id).observations[`${anna.id}:${detail.columns[0].id}`]).toBe('Molt bona expressió escrita');
  });

  it('normaliza las notas numéricas a mayúsculas antes de guardarlas', () => {
    const pau = db.addStudent('ESO_1', 'Pau Soler');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música', gradeMode: 'NUMERIC' });
    const assessment = db.addAssessment(sheet.id, 'EXAM', 'Examen 1', '2026-09-12').columns[0];

    db.saveCell(sheet.id, pau.id, assessment.id, 'grade', ' np ');

    expect(db.getWorksheet(sheet.id).values[`${pau.id}:${assessment.id}`]).toBe('NP');
  });

  it('impide combinaciones de hoja duplicadas', () => {
    const input = { courseLevel: 'ESO_1' as const, trimester: 'T_1' as const, subject: 'Música' };
    db.createWorksheet(input);
    expect(() => db.createWorksheet(input)).toThrow('DUPLICATE_WORKSHEET');
  });

  it('copia la estructura de una hoja en otro trimestre sin fechas ni datos', () => {
    const student = db.addStudent('ESO_1', 'Anna Pérez');
    db.addStudent('ESO_1', 'Pau Soler');
    const source = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música' });
    const exam = db.addAssessment(source.id, 'EXAM', 'Examen 1', '2026-09-12').columns[0];
    const activity = db.addAssessment(source.id, 'CONTINUOUS_ASSESSMENT', 'Comentari', '2026-09-13').columns[1];
    db.saveCell(source.id, student.id, exam.id, 'grade', '8');
    db.saveCell(source.id, student.id, activity.id, 'observation', 'Correcte');
    db.replaceCourseRoster('ESO_1', ['Anna Pérez', 'Marc López']);

    const copy = db.copyWorksheet(source.id, 'T_2');
    const detail = db.getWorksheet(copy.id);
    expect(detail).toMatchObject({ trimester: 'T_2', subject: 'Música', gradeMode: 'NUMERIC', isElective: false });
    expect(detail.columns).toMatchObject([
      { name: 'Examen 1', kind: 'EXAM', assessmentDate: '' },
      { name: 'Comentari', kind: 'CONTINUOUS_ASSESSMENT', assessmentDate: '' }
    ]);
    expect(detail.values).toEqual({});
    expect(detail.observations).toEqual({});
    expect(db.listWorksheets().find(sheet => sheet.id === copy.id)?.changeSummary).toEqual({ addedStudents: ['Marc López'], removedStudents: ['Pau Soler'], addedAssessments: [] });
    const newAssessment = db.addAssessment(copy.id, 'EXAM', 'Examen 2', '2026-10-01').columns.at(-1)!;
    expect(db.listWorksheets().find(sheet => sheet.id === copy.id)?.changeSummary?.addedAssessments).toEqual(['Examen 2']);
    expect(() => db.deleteColumn(detail.columns[0].id)).toThrow('COPIED_ASSESSMENT_CANNOT_BE_DELETED');
    db.deleteColumn(newAssessment.id);
    expect(() => db.copyWorksheet(source.id, 'T_2')).toThrow('DUPLICATE_WORKSHEET');
  });

  it('genera una exportación sin ids SQLite', () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    const pau = db.addStudent('ESO_1', 'Pau Soler');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música' });
    const assessment = db.addAssessment(sheet.id, 'EXAM', 'Examen 1', '2026-09-12').columns[0];
    db.saveCell(sheet.id, pau.id, assessment.id, 'grade', '7');
    const output = buildExport(db, sheet.id);
    expect(output.format).toBe('full-seguiment');
    expect(output.students[0]).toEqual({ name: 'Pau Soler', enabled: true, values: { [assessment.exportId]: '7' }, observations: { [assessment.exportId]: '' } });
    expect(JSON.stringify(output)).not.toContain('worksheetId');
    expect(suggestedFilename(output)).toBe('ESO1_T1_Musica.edutrack');
  });

  it('impide exportar una asignatura con notas pendientes', () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    db.addStudent('ESO_1', 'Pau Soler');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música' });
    db.addAssessment(sheet.id, 'EXAM', 'Examen 1', '2026-09-12');
    expect(() => buildExport(db, sheet.id)).toThrow('INCOMPLETE_WORKSHEET');
  });

  it.each(['NP', '-'])('permite exportar %s como valor especial sin nota numérica', value => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    const pau = db.addStudent('ESO_1', 'Pau Soler');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música' });
    const assessment = db.addAssessment(sheet.id, 'EXAM', 'Examen 1', '2026-09-12').columns[0];
    db.saveCell(sheet.id, pau.id, assessment.id, 'grade', value);

    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(true);
    expect(buildExport(db, sheet.id).students[0].values[assessment.exportId]).toBe(value);
  });

  it('permite desactivar alumnado en una optativa y no exige sus notas', () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    const anna = db.addStudent('ESO_1', 'Anna');
    const pau = db.addStudent('ESO_1', 'Pau');
    const laia = db.addStudent('ESO_1', 'Laia');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Biologia i Geologia', isElective: true });
    db.configureElectiveStudents(sheet.id, [anna.id, pau.id]);
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-09-13').columns[0];
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', '8');
    db.saveCell(sheet.id, pau.id, exam.id, 'grade', '7');
    expect(db.listWorksheets().find(item => item.id === sheet.id)).toMatchObject({ isElective: true, isComplete: true });
    const output = buildExport(db, sheet.id);
    expect(output.subject.isElective).toBe(true);
    expect(output.students.find(student => student.name === laia.fullName)?.enabled).toBe(false);
  });

  it('sustituye una lista importada conservando datos de nombres coincidentes', () => {
    const anna = db.addStudent('ESO_2', 'Anna Pérez');
    const removed = db.addStudent('ESO_2', 'Marc López');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_2', trimester: 'T_1', subject: 'Matemàtiques' });
    const column = db.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-09-12').columns[0];
    db.saveCell(sheet.id, anna.id, column.id, 'grade', '8');
    db.saveCell(sheet.id, removed.id, column.id, 'grade', '5');
    const next = db.replaceCourseRoster('ESO_2', ['Anna Pérez', 'Laia García']);
    expect(next.map(student => student.fullName)).toEqual(['Anna Pérez', 'Laia García']);
    expect(next[0].id).toBe(anna.id);
    expect(db.getWorksheet(sheet.id).values[`${anna.id}:${column.id}`]).toBe('8');
    expect(db.getWorksheet(sheet.id).values[`${removed.id}:${column.id}`]).toBeUndefined();
  });

  it('marca una hoja completa solo cuando todos tienen nota en todas las evaluaciones', () => {
    const anna = db.addStudent('ESO_3', 'Anna'); const pau = db.addStudent('ESO_3', 'Pau');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Llengua Catalana' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-09-12').columns[0];
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', '8');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(false);
    db.saveCell(sheet.id, pau.id, exam.id, 'grade', '5');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(true);
    db.saveCell(sheet.id, pau.id, exam.id, 'grade', '11');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(false);
    db.saveCell(sheet.id, pau.id, exam.id, 'grade', '5');
    db.saveCell(sheet.id, pau.id, exam.id, 'observation', 'Correcte');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(true);
  });

  it('admite notas con letras y modificadores como AN+ o AE-', () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    db.saveCenterConfiguration({ ...DEFAULT_CENTER_CONFIGURATION, grades: [...DEFAULT_GRADE_CONVERSION], hasLetterGrades: true });
    const anna = db.addStudent('ESO_3', 'Anna');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Llengua Catalana', gradeMode: 'LETTER' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-09-12').columns[0];
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', 'AN+');
    const summary = db.listWorksheets().find(item => item.id === sheet.id);
    expect(summary?.gradeMode).toBe('LETTER');
    expect(summary?.isComplete).toBe(true);
    expect(buildExport(db, sheet.id).subject.gradeMode).toBe('LETTER');
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', 'AE-');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(true);
  });

  it('valida el catálogo de letras y permite notas numéricas en hojas con letras', () => {
    db.saveCenterConfiguration({ ...DEFAULT_CENTER_CONFIGURATION, grades: [...DEFAULT_GRADE_CONVERSION], hasLetterGrades: true });
    const anna = db.addStudent('ESO_3', 'Anna'); const pau = db.addStudent('ESO_3', 'Pau');
    const sheet = db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Llengua Catalana', gradeMode: 'LETTER' });
    const exam = db.addAssessment(sheet.id, 'EXAM', 'Examen', '2026-09-12').columns[0];
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', 'an+');
    db.saveCell(sheet.id, pau.id, exam.id, 'grade', '7,5');
    expect(db.getWorksheet(sheet.id).values[`${anna.id}:${exam.id}`]).toBe('AN+');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(true);
    db.saveCell(sheet.id, anna.id, exam.id, 'grade', 'NO_VALIDA');
    expect(db.listWorksheets().find(item => item.id === sheet.id)?.isComplete).toBe(false);
  });

  it('permite sustituir los catálogos por los propios del centro', () => {
    expect(db.replaceCourses(['Infantil 5 anys', '1r Batxillerat']).map(course => course.name)).toEqual(['Infantil 5 anys', '1r Batxillerat']);
    expect(db.replaceSubjectCatalog([{ course: '1r Batxillerat', subject: 'Literatura universal' }]).map(subject => subject.name)).toEqual(['Literatura universal']);
    db.saveSchoolLogo('data:image/png;base64,abc');
    expect(db.getInitialState().schoolLogo).toBe('data:image/png;base64,abc');
  });

  it('guarda la ponderación y el formato del informe desde los datos del centro', () => {
    db.replaceCenterData([{ name: '1r ESO', subjects: ['Català'], students: ['Aina Bosch'] }], { ...DEFAULT_CENTER_CONFIGURATION, examWeight: 60, continuousAssessmentWeight: 40, finalReportGradeMode: 'LETTER', grades: [...DEFAULT_GRADE_CONVERSION], hasAssessmentWeights: true, hasLetterGrades: true });
    expect(db.getInitialState().centerConfiguration).toMatchObject({ examWeight: 60, continuousAssessmentWeight: 40, finalReportGradeMode: 'LETTER', hasAssessmentWeights: true, hasLetterGrades: true });
  });

  it('no permite crear hojas con letras sin una configuración explícita del centro', () => {
    expect(() => db.createWorksheet({ courseLevel: 'ESO_3', trimester: 'T_1', subject: 'Llengua Catalana', gradeMode: 'LETTER' })).toThrow('Las notas con letras no están configuradas para el centro.');
  });

  it('borra los datos académicos del centro y conserva las preferencias personales', () => {
    db.saveProfile({ firstName: 'Marta', lastName: 'Serra' });
    db.saveSchoolLogo('data:image/png;base64,abc');
    const student = db.addStudent('ESO_1', 'Pau Soler');
    db.createWorksheet({ courseLevel: 'ESO_1', trimester: 'T_1', subject: 'Música' });
    db.saveImport({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: 'Música' }, columns: [], students: [{ name: student.fullName, values: {} }]
    }, false);
    const reportId = db.listTrackingReports()[0].id;
    db.saveTutorObservation(reportId, student.id, 'Observación de tutoría');
    db.clearCenterData();
    const state = db.getInitialState();
    expect(state.courses).toEqual([]);
    expect(state.subjects).toEqual([]);
    expect(state.students).toEqual([]);
    expect(state.worksheets).toEqual([]);
    expect(state.imports).toEqual([]);
    expect(state.trackingReports).toEqual([]);
    expect(state.tutorObservations).toEqual({});
    expect(state.profile).toEqual({ firstName: 'Marta', lastName: 'Serra', sex: 'MALE' });
    expect(state.schoolLogo).toBe('data:image/png;base64,abc');
  });

  it('guarda observaciones del tutor por alumno y trimestre', () => {
    const student = db.addStudent('ESO_2', 'Anna Pérez');
    const delivery = (trimester: 'T_1' | 'T_2'): FullSeguimentExport => ({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z', teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_2', name: '2n ESO' }, trimester: { id: trimester, name: trimester }, subject: { name: 'Matemàtiques' }, columns: [], students: [{ name: student.fullName, values: {} }]
    });
    db.saveImport(delivery('T_1'), false); db.saveImport(delivery('T_2'), false);
    const [firstReport, secondReport] = db.listTrackingReports();
    db.saveTutorObservation(firstReport.id, student.id, 'Necesita seguimiento individual.');
    db.saveTutorObservation(secondReport.id, student.id, 'Ha mejorado durante el trimestre.');
    expect(db.getInitialState().tutorObservations).toEqual({
      [`${firstReport.id}:${student.id}`]: 'Necesita seguimiento individual.',
      [`${secondReport.id}:${student.id}`]: 'Ha mejorado durante el trimestre.'
    });
    db.saveTutorObservation(firstReport.id, student.id, '');
    expect(db.getInitialState().tutorObservations[`${firstReport.id}:${student.id}`]).toBeUndefined();
  });

  it('guarda el sexo del docente y usa masculino por defecto', () => {
    expect(db.getProfile().sex).toBe('MALE');
    expect(db.saveProfile({ firstName: 'Marta', lastName: 'Serra', sex: 'FEMALE' }).sex).toBe('FEMALE');
  });

  it('elimina únicamente la entrega importada seleccionada', () => {
    const delivery: FullSeguimentExport = {
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: 'Música' }, columns: [], students: [{ name: 'Pau Soler', values: {} }]
    };
    db.saveImport(delivery, false);
    const imported = db.listImports()[0];
    db.deleteImportedWorksheet(imported.id);
    expect(db.listImports()).toEqual([]);
  });

  it('genera informes solo con las entregas importadas del curso y trimestre seleccionados', () => {
    const student = db.addStudent('ESO_1', 'Pau Soler');
    const delivery = (trimester: 'T_1' | 'T_2', subject: string, grade: string): FullSeguimentExport => ({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra', sex: 'FEMALE' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: trimester, name: trimester === 'T_1' ? '1r Trimestre' : '2n Trimestre' },
      subject: { name: subject, gradeMode: 'NUMERIC' }, columns: [{ id: 'exam', name: 'Examen' }],
      students: [{ name: student.fullName, values: { exam: grade }, observations: { exam: 'Seguimiento docente' } }]
    });
    db.saveImport(delivery('T_1', 'Llengua Castellana', '8'), false);
    db.saveImport(delivery('T_2', 'Música', '6'), false);
    const reportId = db.listTrackingReports().find(item => item.trimester === 'T_1')!.id;
    db.saveTutorObservation(reportId, student.id, 'Observación de tutoría');

    const report = buildTrackingReports(db, reportId);
    expect(report.course.level).toBe('ESO_1');
    expect(report.trimester.id).toBe('T_1');
    expect(report.subjects.map(subject => subject.name)).toEqual(['Llengua Castellana']);
    expect(report.students[0]).toMatchObject({
      name: 'Pau Soler', tutorObservation: 'Observación de tutoría',
      subjects: [{ name: 'Llengua Castellana', values: { exam: '8' } }]
    });
    db.deleteTrackingReport(reportId);
    expect(db.listImports().map(item => [item.trimester, item.subject])).toEqual([['T_2', 'Música']]);
    expect(db.listTutorObservations()[`${reportId}:${student.id}`]).toBeUndefined();
  });

  it('permite excluir una entrega del informe sin borrarla', () => {
    const student = db.addStudent('ESO_1', 'Pau Soler');
    const delivery = (subject: string): FullSeguimentExport => ({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: subject, gradeMode: 'NUMERIC' }, columns: [{ id: 'exam', name: 'Examen' }],
      students: [{ name: student.fullName, values: { exam: '8' } }]
    });
    db.saveImport(delivery('Llengua Castellana'), false);
    db.saveImport(delivery('Música'), false);
    const reportId = db.listTrackingReports()[0].id;
    const excluded = db.listImports(reportId).find(item => item.subject === 'Música')!;

    expect(excluded.isBlocking).toBe(true);
    expect(db.setImportedWorksheetBlocking(excluded.id, false)).toMatchObject({ isBlocking: false });
    expect(buildTrackingReports(db, reportId).subjects.map(subject => subject.name)).toEqual(['Llengua Castellana']);
    expect(db.listImports(reportId).find(item => item.id === excluded.id)?.isBlocking).toBe(false);
  });

  it('mantiene las asignaturas optativas separadas en el informe', () => {
    const anna = db.addStudent('ESO_1', 'Anna');
    const pau = db.addStudent('ESO_1', 'Pau');
    db.replaceSubjectCatalog([{ course: '1r ESO', subject: 'Biologia i Geologia' }, { course: '1r ESO', subject: 'Francès' }]);
    const delivery = (subject: string, enabledName: string, grade: string): FullSeguimentExport => ({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: subject, gradeMode: 'NUMERIC', isElective: true }, columns: [{ id: 'exam', name: 'Examen' }],
      students: [anna, pau].map(student => ({ name: student.fullName, enabled: student.fullName === enabledName, values: { exam: student.fullName === enabledName ? grade : '' }, observations: { exam: '' } }))
    });
    db.saveImport(delivery('Biologia i Geologia', 'Anna', '8'), false);
    db.saveImport(delivery('Francès', 'Pau', '7'), false);
    const report = buildTrackingReports(db, db.listTrackingReports()[0].id);
    expect(report.subjects.map(subject => subject.name)).toEqual(['Biologia i Geologia', 'Francès']);
    expect(report.students.map(student => [student.name, student.subjects.map(subject => Object.values(subject.values)[0] ?? '')])).toEqual([
      ['Anna', ['8', '']],
      ['Pau', ['', '7']]
    ]);
  });

  it('solo cuenta como calificado el alumnado optativo con nota en todas las evaluaciones', () => {
    const delivery: FullSeguimentExport = {
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z',
      teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
      subject: { name: 'Francès', gradeMode: 'NUMERIC', isElective: true },
      columns: [{ id: 'exam', name: 'Examen' }, { id: 'project', name: 'Projecte' }],
      students: [
        { name: 'Anna', enabled: true, values: { exam: '8', project: '7' } },
        { name: 'Pau', enabled: true, values: { exam: '6', project: 'np' } },
        { name: 'Marc', enabled: false, values: { exam: '', project: '' } }
      ]
    };
    db.saveImport(delivery, false);
    expect(db.listImports()[0]).toMatchObject({
      enabledStudentNames: ['Anna', 'Pau'],
      gradedStudentNames: ['Anna', 'Pau']
    });
    expect(db.getImportedWorksheet(db.listImports()[0].id).payload.students[1].values.project).toBe('NP');
  });

  it('copia un informe y dirige las importaciones posteriores únicamente a la copia más reciente', () => {
    const student = db.addStudent('ESO_1', 'Anna');
    const delivery = (grade: string, subject = 'Música'): FullSeguimentExport => ({
      format: 'full-seguiment', version: 1, exportedAt: '2026-09-13T10:00:00.000Z', teacher: { firstName: 'Marta', lastName: 'Serra' },
      course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' }, subject: { name: subject, gradeMode: 'NUMERIC' },
      columns: [{ id: 'exam', name: 'Examen' }], students: [{ name: student.fullName, values: { exam: grade } }]
    });
    db.saveImport(delivery('6'), false);
    const first = db.listTrackingReports()[0];
    db.saveTutorObservation(first.id, student.id, 'Observación inicial');
    const second = db.copyTrackingReport(first.id);
    expect(() => db.copyTrackingReport(first.id)).toThrow('ONLY_LATEST_REPORT_CAN_BE_COPIED');

    db.saveImport(delivery('9'), true);
    db.saveImport(delivery('8', 'Llengua Castellana'), false);

    expect(db.listTrackingReports().map(report => report.sequence)).toEqual([1, 2]);
    expect(db.getImportedWorksheet(db.listImports(first.id)[0].id).payload.students[0].values.exam).toBe('6');
    expect(db.getImportedWorksheet(db.listImports(second.id).find(item => item.subject === 'Música')!.id).payload.students[0].values.exam).toBe('9');
    expect(db.listImports(first.id).map(item => item.subject)).toEqual(['Música']);
    expect(db.listImports(second.id).map(item => item.subject)).toEqual(['Llengua Castellana', 'Música']);
    expect(db.listTutorObservations()[`${second.id}:${student.id}`]).toBe('Observación inicial');

    const oldDelivery = db.listImports(first.id)[0];
    expect(() => db.saveTutorObservation(first.id, student.id, 'No se puede editar')).toThrow('READ_ONLY_REPORT');
    expect(() => db.setImportedWorksheetBlocking(oldDelivery.id, false)).toThrow('READ_ONLY_REPORT');
    expect(() => db.deleteImportedWorksheet(oldDelivery.id)).toThrow('READ_ONLY_REPORT');
    expect(() => db.deleteTrackingReport(first.id)).toThrow('ONLY_LATEST_REPORT_CAN_BE_DELETED');
    db.deleteTrackingReport(second.id);
    expect(db.listTrackingReports().map(report => report.sequence)).toEqual([1]);
    db.deleteTrackingReport(first.id);
    expect(db.listTrackingReports()).toEqual([]);
    expect(db.listImports()).toEqual([]);
    expect(db.listTutorObservations()).toEqual({});
  });
});

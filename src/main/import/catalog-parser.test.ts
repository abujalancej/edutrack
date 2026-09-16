import { describe, expect, it } from 'vitest';
import { parseCenterFile, parseCoursesFile, parseSubjectsFile } from './catalog-parser';

describe('catalog-parser', () => {
  it('lee cursos desde CSV y JSON', () => {
    expect(parseCoursesFile('Curso\n1r ESO\n2n ESO', '.csv')).toEqual({ ok: true, names: ['1r ESO', '2n ESO'] });
    expect(parseCoursesFile('{"courses":["3r ESO",{"name":"4t ESO"}]}', '.json')).toEqual({ ok: true, names: ['3r ESO', '4t ESO'] });
  });

  it('lee asignaturas agrupadas o tabulares', () => {
    expect(parseSubjectsFile('{"3r ESO":["Llengua Catalana","Matemàtiques"]}', '.json')).toEqual({ ok: true, entries: [{ course: '3r ESO', subject: 'Llengua Catalana' }, { course: '3r ESO', subject: 'Matemàtiques' }] });
    expect(parseSubjectsFile('Curso;Asignatura\n3r ESO;Llengua Catalana', '.csv')).toEqual({ ok: true, entries: [{ course: '3r ESO', subject: 'Llengua Catalana' }] });
  });

  it('lee la configuración completa del centro en un solo archivo', () => {
    expect(parseCenterFile('Curso;Asignaturas;Alumnos\n3r ESO;Llengua Catalana|Matemàtiques;Anna Pérez|Marc López', '.csv')).toMatchObject({ ok: true, courses: [{ name: '3r ESO', subjects: ['Llengua Catalana', 'Matemàtiques'], students: ['Anna Pérez', 'Marc López'] }], centerConfiguration: { examWeight: 0, continuousAssessmentWeight: 0, finalReportGradeMode: 'NUMERIC', notEvaluatedValue: '-', hasAssessmentWeights: false, hasLetterGrades: false, grades: [] } });
    expect(parseCenterFile('{"assessmentWeights":{"exam":60,"continuousAssessment":40},"finalReportGradeMode":"LETTER","notEvaluated":"NE","grades":[{"grade":"NA","from":0}],"gradesExplanation":{"NA":"No assoliment"},"courses":[{"name":"3r ESO","subjects":["Llengua Catalana"],"students":["Anna","Marc"]}]}', '.json')).toMatchObject({ ok: true, centerConfiguration: { examWeight: 60, continuousAssessmentWeight: 40, finalReportGradeMode: 'LETTER', notEvaluatedValue: 'NE', gradesExplanation: { NA: 'No assoliment' }, hasAssessmentWeights: true, hasLetterGrades: true } });
  });

  it.each([
    'Curso;Asignaturas;Alumnos', 'Curs;Assignatures;Alumnes', 'Course;Subjects;Students',
    'Maila;Irakasgaiak;Ikasleak', 'Curso;Materias;Alumnos'
  ])('admite las cabeceras del ejemplo localizado: %s', headers => {
    expect(parseCenterFile(`${headers}\n1.º ESO;Matemáticas;Ana Pérez`, '.csv')).toMatchObject({ ok: true, courses: [{ name: '1.º ESO', subjects: ['Matemáticas'], students: ['Ana Pérez'] }] });
  });

  it('rechaza porcentajes incompletos o con formato incorrecto', () => {
    const base = { courses: [{ name: '3r ESO', subjects: ['Llengua Catalana'], students: ['Anna'] }] };
    expect(parseCenterFile(JSON.stringify({ ...base, assessmentWeights: { exam: 70 } }), '.json').ok).toBe(false);
    expect(parseCenterFile(JSON.stringify({ ...base, assessmentWeights: { continuousAssessment: 30 } }), '.json').ok).toBe(false);
    expect(parseCenterFile(JSON.stringify({ ...base, assessmentWeights: { exam: '70', continuousAssessment: 30 } }), '.json').ok).toBe(false);
    expect(parseCenterFile(JSON.stringify({ ...base, assessmentWeights: [] }), '.json').ok).toBe(false);
    expect(parseCenterFile(JSON.stringify({ ...base, examWeight: 70 }), '.json').ok).toBe(false);
  });

  it('exige gradesExplanation cuando el formato final usa letras', () => {
    const base = { finalReportGradeMode: 'LETTER', grades: [{ grade: 'NA', from: 0 }], courses: [{ name: '3r ESO', subjects: ['Llengua Catalana'], students: ['Anna'] }] };
    expect(parseCenterFile(JSON.stringify(base), '.json').ok).toBe(false);
    expect(parseCenterFile(JSON.stringify({ ...base, gradesExplanation: {} }), '.json').ok).toBe(false);
  });

  it('mantiene solo notas numéricas cuando faltan los campos opcionales', () => {
    const result = parseCenterFile('{"courses":[{"name":"3r ESO","subjects":["Llengua Catalana"],"students":["Anna"]}]}', '.json');
    expect(result).toMatchObject({ ok: true, centerConfiguration: { examWeight: 0, continuousAssessmentWeight: 0, finalReportGradeMode: 'NUMERIC', notEvaluatedValue: '-', grades: [], hasAssessmentWeights: false, hasLetterGrades: false } });
  });

  it('mantiene notas numéricas si la configuración de letras está incompleta', () => {
    const base = { courses: [{ name: '3r ESO', subjects: ['Llengua Catalana'], students: ['Anna'] }] };
    expect(parseCenterFile(JSON.stringify({ ...base, grades: [{ grade: 'NA', from: 0 }] }), '.json')).toMatchObject({ ok: true, centerConfiguration: { finalReportGradeMode: 'NUMERIC', hasLetterGrades: false, grades: [] } });
    expect(parseCenterFile(JSON.stringify({ ...base, gradesExplanation: { NA: 'No assoliment' } }), '.json')).toMatchObject({ ok: true, centerConfiguration: { finalReportGradeMode: 'NUMERIC', hasLetterGrades: false, grades: [] } });
    expect(parseCenterFile(JSON.stringify({ ...base, finalReportGradeMode: 'LETTER', gradesExplanation: { NA: 'No assoliment' } }), '.json').ok).toBe(false);
  });

  it('valida una configuración completa del centro sin archivos externos', () => {
    const content = JSON.stringify({
      assessmentWeights: { exam: 70, continuousAssessment: 30 },
      finalReportGradeMode: 'LETTER',
      notEvaluated: 'NP',
      grades: [{ grade: 'NA-', from: 0 }, { grade: 'AE+', from: 9.8 }],
      gradesExplanation: { NA: 'No assolit', AE: 'Assoliment excel·lent' },
      courses: [
        { name: '1r ESO', subjects: ['Català', 'Anglès'], students: ['Aina Bosch', 'Biel Casas'] },
        { name: '2n ESO', subjects: ['Català', 'Anglès'], students: ['Carla Costa', 'David Duran'] }
      ]
    });
    const result = parseCenterFile(content, '.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.courses).toHaveLength(2);
    expect(result.courses.map(course => course.students.length)).toEqual([2, 2]);
    expect(result.centerConfiguration).toMatchObject({ examWeight: 70, continuousAssessmentWeight: 30, finalReportGradeMode: 'LETTER' });
    expect(result.centerConfiguration.grades).toEqual(expect.arrayContaining([{ grade: 'NA-', from: 0 }, { grade: 'AE+', from: 9.8 }]));
  });
});

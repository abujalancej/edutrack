import { readFileSync } from 'node:fs';
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
    expect(parseCenterFile('Curso;Asignaturas;Alumnos\n3r ESO;Llengua Catalana|Matemàtiques;Anna Pérez|Marc López', '.csv')).toMatchObject({ ok: true, courses: [{ name: '3r ESO', subjects: ['Llengua Catalana', 'Matemàtiques'], students: ['Anna Pérez', 'Marc López'] }], centerConfiguration: { examWeight: 70, continuousAssessmentWeight: 30, finalReportGradeMode: 'NUMERIC', hasAssessmentWeights: false, hasLetterGrades: false, grades: [] } });
    expect(parseCenterFile('{"assessmentWeights":{"exam":60,"continuousAssessment":40},"finalReportGradeMode":"LETTER","grades":[{"grade":"NA","from":0}],"courses":[{"name":"3r ESO","subjects":["Llengua Catalana"],"students":["Anna","Marc"]}]}', '.json')).toMatchObject({ ok: true, centerConfiguration: { examWeight: 60, continuousAssessmentWeight: 40, finalReportGradeMode: 'LETTER', hasAssessmentWeights: true, hasLetterGrades: true } });
  });

  it('mantiene solo notas numéricas cuando faltan los campos opcionales', () => {
    const result = parseCenterFile('{"courses":[{"name":"3r ESO","subjects":["Llengua Catalana"],"students":["Anna"]}]}', '.json');
    expect(result).toMatchObject({ ok: true, centerConfiguration: { finalReportGradeMode: 'NUMERIC', grades: [], hasAssessmentWeights: false, hasLetterGrades: false } });
  });

  it('valida el ejemplo completo del centro con configuración', () => {
    const content = readFileSync(new URL('../../../examples/datos_centro_configuracion_ejemplo.json', import.meta.url), 'utf8');
    const result = parseCenterFile(content, '.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.courses).toHaveLength(4);
    expect(result.courses.map(course => course.students.length)).toEqual([2, 2, 2, 2]);
    expect(result.centerConfiguration).toMatchObject({ examWeight: 70, continuousAssessmentWeight: 30, finalReportGradeMode: 'NUMERIC' });
    expect(result.centerConfiguration.grades).toEqual(expect.arrayContaining([{ grade: 'NA-', from: 0 }, { grade: 'AE+', from: 9.8 }]));
  });
});

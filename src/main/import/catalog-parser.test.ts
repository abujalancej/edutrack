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
    expect(parseCenterFile('Curso;Asignaturas;Alumnos\n3r ESO;Llengua Catalana|Matemàtiques;Anna Pérez|Marc López', '.csv')).toEqual({ ok: true, courses: [{ name: '3r ESO', subjects: ['Llengua Catalana', 'Matemàtiques'], students: ['Anna Pérez', 'Marc López'] }] });
    expect(parseCenterFile('{"courses":[{"name":"3r ESO","subjects":["Llengua Catalana"],"students":["Anna","Marc"]}]}', '.json').ok).toBe(true);
  });

  it.each(['csv', 'json'])('valida el ejemplo completo del centro en %s', extension => {
    const content = readFileSync(new URL(`../../../examples/datos_centro_ejemplo.${extension}`, import.meta.url), 'utf8');
    const result = parseCenterFile(content, `.${extension}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.courses).toHaveLength(4);
    expect(result.courses.map(course => course.students.length)).toEqual([30, 30, 30, 30]);
    expect(new Set(result.courses.flatMap(course => course.students)).size).toBe(120);
  });
});

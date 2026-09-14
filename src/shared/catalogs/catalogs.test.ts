import { describe, expect, it } from 'vitest';
import { COURSE_LEVELS, SUBJECTS_BY_COURSE, isValidSubject, sheetLabel } from './catalogs';

describe('catálogos académicos', () => {
  it('mantiene cuatro cursos cerrados y asignaturas dependientes', () => {
    expect(COURSE_LEVELS).toEqual(['ESO_1', 'ESO_2', 'ESO_3', 'ESO_4']);
    expect(isValidSubject('ESO_2', 'Tecnologia/Robòtica')).toBe(true);
    expect(isValidSubject('ESO_4', 'Tecnologia/Robòtica')).toBe(false);
    expect(SUBJECTS_BY_COURSE.ESO_4).toContain('Valors Cívics');
  });

  it('crea la etiqueta canónica de una hoja', () => {
    expect(sheetLabel('ESO_2', 'T_1', 'Tecnologia/Robòtica')).toBe('2n ESO · 1r Trimestre · Tecnologia/Robòtica');
  });
});

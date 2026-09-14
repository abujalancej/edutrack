import { describe, expect, it } from 'vitest';
import { subjectMonograms } from './subject-monogram';

describe('abreviaciones de asignaturas', () => {
  it('usa siempre dos letras e iniciales naturales cuando no hay colisiones', () => {
    const result = subjectMonograms(['Optativa', 'Educació Física', 'Biologia i Geologia', 'Música']);
    expect(Object.fromEntries(result)).toEqual({ Optativa: 'OP', 'Educació Física': 'EF', 'Biologia i Geologia': 'BG', Música: 'MU' });
  });

  it('busca letras diferenciadoras cuando dos asignaturas coinciden', () => {
    const result = subjectMonograms(['Llengua Castellana', 'Llengua Catalana']);
    expect(result.get('Llengua Castellana')).toBe('CS');
    expect(result.get('Llengua Catalana')).toBe('CT');
    expect(new Set(result.values()).size).toBe(2);
  });
});

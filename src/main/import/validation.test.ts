import { describe, expect, it } from 'vitest';
import type { FullSeguimentExport } from '../../shared/types/models';
import { compareStudentNames, validateImport } from './validation';

const valid: FullSeguimentExport = {
  format: 'full-seguiment', version: 1, exportedAt: '2026-09-12T10:00:00.000Z',
  teacher: { firstName: 'Adrián', lastName: 'García' },
  course: { level: 'ESO_2', name: '2n ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
  subject: { name: 'Tecnologia/Robòtica' }, columns: [{ id: 'col_a', name: 'Examen 1' }],
  students: [{ name: 'Anna Pérez', values: { col_a: '7.5' } }]
};

describe('validateImport', () => {
  it('acepta una entrega portable válida', () => expect(validateImport(valid).ok).toBe(true));
  it('acepta el identificador antiguo de trimestre y lo normaliza', () => {
    const legacy = { ...valid, trimester: { ...valid.trimester, id: 'TRIMESTER_1' } };
    const result = validateImport(legacy);
    expect(result.ok && result.data.trimester.id).toBe('T_1');
  });
  it('acepta entregas con notas de letras', () => expect(validateImport({ ...valid, subject: { ...valid.subject, gradeMode: 'LETTER' } }).ok).toBe(true));
  it('acepta una optativa con alumnado desactivado', () => expect(validateImport({ ...valid, subject: { ...valid.subject, isElective: true }, students: [{ ...valid.students[0], enabled: false }] }).ok).toBe(true));
  it('rechaza tipos de nota desconocidos', () => expect(validateImport({ ...valid, subject: { ...valid.subject, gradeMode: 'STARS' } }).ok).toBe(false));
  it('admite catálogos de asignaturas configurables', () => expect(validateImport({ ...valid, subject: { name: 'Proyecto propio del centro' } }).ok).toBe(true));
  it('rechaza valores asociados a columnas inexistentes', () => {
    const input = { ...valid, students: [{ name: 'Anna Pérez', values: { otra: '8' } }] };
    expect(validateImport(input).ok).toBe(false);
  });
  it('informa diferencias exactas y conserva duplicados', () => {
    expect(compareStudentNames(['Anna', 'Marc', 'Marc'], ['Anna', 'Marc', 'Març'])).toEqual({ missingInFile: ['Marc'], extraInFile: ['Març'], matches: false });
  });
});

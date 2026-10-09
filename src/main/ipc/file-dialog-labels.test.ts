import { describe, expect, it } from 'vitest';
import { fileDialogLabels } from './file-dialog-labels';

describe('file dialog language', () => {
  it.each([
    ['es', 'Datos del centro', 'Catálogo de asignaturas'],
    ['ca', 'Dades del centre', 'Catàleg d’assignatures'],
    ['en', 'School data', 'Subject catalogue'],
    ['eu', 'Ikastetxeko datuak', 'Irakasgaien katalogoa'],
    ['gl', 'Datos do centro', 'Catálogo de materias']
  ] as const)('uses the current language %s', (language, center, subjects) => {
    expect(fileDialogLabels(language)).toMatchObject({ center, subjects });
  });
});

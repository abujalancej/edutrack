import { describe, expect, it } from 'vitest';
import { parseClipboardRows } from './TutorObservationGrid';

describe('observaciones copiadas de Excel', () => {
  it('reparte las filas de Windows y conserva alumnos con observaciones vacías', () => {
    expect(parseClipboardRows('Primera\r\n\r\nTercera\r\n')).toEqual([['Primera'], [''], ['Tercera']]);
  });
  it('conserva los saltos de línea dentro de una observación', () => {
    expect(parseClipboardRows('"Primera línea\r\nSegunda línea"\r\nOtro alumno\r\n')).toEqual([['Primera línea\nSegunda línea'], ['Otro alumno']]);
  });
  it('interpreta comillas escapadas y tabuladores dentro de una celda', () => {
    expect(parseClipboardRows('"Ha dicho ""bien""\t hoy"\tOtra columna\r\n')).toEqual([['Ha dicho "bien"\t hoy', 'Otra columna']]);
  });
  it('conserva la última fila aunque no tenga salto final', () => {
    expect(parseClipboardRows('Primera\nSegunda')).toEqual([['Primera'], ['Segunda']]);
  });
});

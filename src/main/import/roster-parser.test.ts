import { describe, expect, it } from 'vitest';
import { parseRosterFile } from './roster-parser';

describe('parseRosterFile', () => {
  it('lee un CSV sencillo con cabecera', () => {
    expect(parseRosterFile('Alumno\nAnna Pérez\nMarc López\n', '.csv')).toEqual({ ok: true, names: ['Anna Pérez', 'Marc López'] });
  });

  it('admite CSV separado por punto y coma y nombres entre comillas', () => {
    expect(parseRosterFile('Alumno;Grupo\n"Pérez, Anna";A\nMarc López;A', '.csv')).toEqual({ ok: true, names: ['Pérez, Anna', 'Marc López'] });
  });

  it('lee un JSON como array o mediante students', () => {
    expect(parseRosterFile('["Anna", "Marc"]', '.json')).toEqual({ ok: true, names: ['Anna', 'Marc'] });
    expect(parseRosterFile('{"students":[{"fullName":"Laia"},{"name":"Pau"}]}', '.json')).toEqual({ ok: true, names: ['Laia', 'Pau'] });
  });

  it('rechaza estructuras y archivos vacíos', () => {
    expect(parseRosterFile('{"course":"ESO_2"}', '.json').ok).toBe(false);
    expect(parseRosterFile('Alumno\n', '.csv').ok).toBe(false);
  });
});

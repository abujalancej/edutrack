import { describe, expect, it } from 'vitest';
import type { FullSeguimentExport } from '../../shared/types/models';
import { compareDeliveryRoster, deliveryRosterError } from './delivery-roster';

const delivery: FullSeguimentExport = {
  format: 'full-seguiment', version: 2, exportedAt: '2026-09-16T10:00:00.000Z',
  teacher: { firstName: 'Marta', lastName: 'Serra' },
  course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' },
  subject: { name: 'Català' }, columns: [],
  students: [
    { name: 'Aina', enrolled: true, values: {} },
    { name: 'Biel', enrolled: false, values: {} }
  ]
};

describe('reconciliación de entregas', () => {
  it('conserva al alumno histórico si tiene una única identidad local en el curso', () => {
    expect(compareDeliveryRoster(delivery, ['Aina'], ['Biel']).matches).toBe(true);
    expect(compareDeliveryRoster(delivery, ['Aina', 'Biel'], []).matches).toBe(true);
  });

  it('bloquea homónimos históricos y nombres parecidos sin emparejamiento automático', () => {
    const ambiguous = compareDeliveryRoster(delivery, ['Aina'], ['Biel', 'Biel']);
    expect(ambiguous.matches).toBe(false);
    expect(ambiguous.extraInFile).toContain('Biel');
    const different = compareDeliveryRoster(delivery, ['Aina Maria'], ['Biel']);
    expect(different.matches).toBe(false);
    expect(deliveryRosterError(different)).toContain('Aina Maria');
    expect(deliveryRosterError(different)).toContain('Aina');
  });
});

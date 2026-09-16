import { describe, expect, it } from 'vitest';
import { isCompleteGradeValue, isSpecialGradeValue } from './grades';

describe('grade values', () => {
  it.each(['-', 'NP', ' np '])('accepts %s as a completed numeric value', value => {
    expect(isCompleteGradeValue(value, 'NUMERIC')).toBe(true);
  });

  it('keeps empty and invalid numeric values incomplete', () => {
    expect(isCompleteGradeValue('', 'NUMERIC')).toBe(false);
    expect(isCompleteGradeValue('11', 'NUMERIC')).toBe(false);
    expect(isSpecialGradeValue('8')).toBe(false);
  });
});

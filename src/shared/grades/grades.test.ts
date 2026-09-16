import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER_CONFIGURATION, letterGradeForNumericValue } from '../center/center-configuration';
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

  it('accepts configured letter grades case-insensitively and numeric values in letter mode', () => {
    expect(isCompleteGradeValue('an+', 'LETTER', DEFAULT_CENTER_CONFIGURATION.grades)).toBe(true);
    expect(isCompleteGradeValue('7,5', 'LETTER', DEFAULT_CENTER_CONFIGURATION.grades)).toBe(true);
    expect(isCompleteGradeValue('inventada', 'LETTER', DEFAULT_CENTER_CONFIGURATION.grades)).toBe(false);
  });

  it('resolves numeric grades through the configured conversion table', () => {
    expect(letterGradeForNumericValue(0)).toBe('NA-');
    expect(letterGradeForNumericValue(7.5)).toBe('AN');
    expect(letterGradeForNumericValue(10)).toBe('AE+');
  });
});

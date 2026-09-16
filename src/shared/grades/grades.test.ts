import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADE_CONVERSION, letterGradeForNumericValue } from '../center/center-configuration';
import { isCompleteGradeValue, isSpecialGradeValue, numericValueForLetterGrade } from './grades';

describe('grade values', () => {
  it.each(['-', ' - '])('accepts %s as the default non-evaluated value', value => {
    expect(isCompleteGradeValue(value, 'NUMERIC')).toBe(true);
  });

  it('keeps empty and invalid numeric values incomplete', () => {
    expect(isCompleteGradeValue('', 'NUMERIC')).toBe(false);
    expect(isCompleteGradeValue('11', 'NUMERIC')).toBe(false);
    expect(isSpecialGradeValue('8')).toBe(false);
    expect(isCompleteGradeValue('NP', 'NUMERIC')).toBe(false);
  });

  it('accepts configured letter grades case-insensitively but rejects numeric values in letter mode', () => {
    expect(isCompleteGradeValue('an+', 'LETTER', DEFAULT_GRADE_CONVERSION)).toBe(true);
    expect(isCompleteGradeValue('7,5', 'LETTER', DEFAULT_GRADE_CONVERSION)).toBe(false);
    expect(isCompleteGradeValue('inventada', 'LETTER', DEFAULT_GRADE_CONVERSION)).toBe(false);
  });

  it('uses the configured non-evaluated value', () => {
    expect(isCompleteGradeValue('ne', 'LETTER', DEFAULT_GRADE_CONVERSION, 'NE')).toBe(true);
    expect(isCompleteGradeValue('NP', 'LETTER', DEFAULT_GRADE_CONVERSION, 'NE')).toBe(false);
    expect(isCompleteGradeValue('-', 'LETTER', DEFAULT_GRADE_CONVERSION, 'NE')).toBe(false);
    expect(isCompleteGradeValue('ne', 'NUMERIC', [], 'NE')).toBe(true);
  });

  it('resolves numeric grades through the configured conversion table', () => {
    expect(letterGradeForNumericValue(0)).toBe('NA-');
    expect(letterGradeForNumericValue(7.5)).toBe('AN');
    expect(letterGradeForNumericValue(10)).toBe('AE+');
  });

  it.each([
    ['NA-', 0], ['NA', 3], ['NA+', 4],
    ['AS-', 5], ['AS', 5.5], ['AS+', 6.5]
  ])('uses the configured value for %s', (grade, expected) => {
    expect(numericValueForLetterGrade(grade, DEFAULT_GRADE_CONVERSION)).toBe(expected);
  });
});

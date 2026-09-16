import { DEFAULT_CENTER_CONFIGURATION } from '../center/center-configuration';
import type { GradeConversion, GradeMode } from '../types/models';

export const normalizeGradeValue = (value: string) => value.trim().toLocaleUpperCase();

export const isSpecialGradeValue = (value: string, notEvaluatedValue = '-') => normalizeGradeValue(value) === normalizeGradeValue(notEvaluatedValue);

export const isValidNumericGrade = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  const numeric = Number(normalized);
  return normalized !== '' && /^\d{1,2}(\.\d{1,2})?$/.test(normalized) && numeric >= 0 && numeric <= 10;
};

export const isValidLetterGrade = (value: string, grades: readonly GradeConversion[] = DEFAULT_CENTER_CONFIGURATION.grades) => grades.some(item => item.grade === normalizeGradeValue(value));

export const numericValueForLetterGrade = (value: string, grades: readonly GradeConversion[] = DEFAULT_CENTER_CONFIGURATION.grades) => grades.find(item => item.grade === normalizeGradeValue(value))?.from;

export const isCompleteGradeValue = (value: string, mode: GradeMode, grades: readonly GradeConversion[] = DEFAULT_CENTER_CONFIGURATION.grades, notEvaluatedValue = '-') => mode === 'LETTER' ? isSpecialGradeValue(value, notEvaluatedValue) || isValidLetterGrade(value, grades) : isSpecialGradeValue(value, notEvaluatedValue) || isValidNumericGrade(value);

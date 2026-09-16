import { DEFAULT_CENTER_CONFIGURATION } from '../center/center-configuration';
import type { GradeConversion, GradeMode } from '../types/models';

export const SPECIAL_GRADE_VALUES = ['-', 'NP'] as const;

export const normalizeGradeValue = (value: string) => value.trim().toLocaleUpperCase();

export const isSpecialGradeValue = (value: string) => SPECIAL_GRADE_VALUES.includes(normalizeGradeValue(value) as typeof SPECIAL_GRADE_VALUES[number]);

export const isValidNumericGrade = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  const numeric = Number(normalized);
  return normalized !== '' && /^\d{1,2}(\.\d{1,2})?$/.test(normalized) && numeric >= 0 && numeric <= 10;
};

export const isValidLetterGrade = (value: string, grades: readonly GradeConversion[] = DEFAULT_CENTER_CONFIGURATION.grades) => grades.some(item => item.grade === normalizeGradeValue(value));

export const isCompleteGradeValue = (value: string, mode: GradeMode, grades: readonly GradeConversion[] = DEFAULT_CENTER_CONFIGURATION.grades) => mode === 'LETTER' ? isSpecialGradeValue(value) || isValidNumericGrade(value) || isValidLetterGrade(value, grades) : isSpecialGradeValue(value) || isValidNumericGrade(value);

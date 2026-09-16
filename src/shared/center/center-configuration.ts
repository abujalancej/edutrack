import type { CenterConfiguration, GradeConversion } from '../types/models';

export const DEFAULT_CENTER_CONFIGURATION: CenterConfiguration = {
  examWeight: 0,
  continuousAssessmentWeight: 0,
  finalReportGradeMode: 'NUMERIC',
  notEvaluatedValue: '-',
  grades: [],
  gradesExplanation: undefined,
  hasAssessmentWeights: false,
  hasLetterGrades: false
};

export const DEFAULT_GRADE_CONVERSION = [
    { grade: 'NA-', from: 0.0 }, { grade: 'NA', from: 3.0 }, { grade: 'NA+', from: 4.0 },
    { grade: 'AS-', from: 5.0 }, { grade: 'AS', from: 5.5 }, { grade: 'AS+', from: 6.5 },
    { grade: 'AN-', from: 7.0 }, { grade: 'AN', from: 7.5 }, { grade: 'AN+', from: 8.5 },
    { grade: 'AE-', from: 9.0 }, { grade: 'AE', from: 9.5 }, { grade: 'AE+', from: 9.8 }
] as const;

export const normalizeCenterConfiguration = (configuration: CenterConfiguration): CenterConfiguration => {
  const configuredExamWeight = Number(configuration.examWeight); const configuredContinuousAssessmentWeight = Number(configuration.continuousAssessmentWeight);
  if (configuration.hasAssessmentWeights && (!Number.isFinite(configuredExamWeight) || !Number.isFinite(configuredContinuousAssessmentWeight) || configuredExamWeight < 0 || configuredContinuousAssessmentWeight < 0 || configuredExamWeight + configuredContinuousAssessmentWeight !== 100)) throw new Error('Los porcentajes de examen y evaluación continua deben sumar 100.');
  const examWeight = configuration.hasAssessmentWeights ? configuredExamWeight : 0;
  const continuousAssessmentWeight = configuration.hasAssessmentWeights ? configuredContinuousAssessmentWeight : 0;
  if (configuration.finalReportGradeMode !== 'NUMERIC' && configuration.finalReportGradeMode !== 'LETTER') throw new Error('El formato del informe final debe ser NUMERIC o LETTER.');
  if (!configuration.hasLetterGrades && configuration.finalReportGradeMode === 'LETTER') throw new Error('Las notas con letras requieren grades y gradesExplanation.');
  if (configuration.hasLetterGrades && (!Array.isArray(configuration.grades) || !configuration.grades.length)) throw new Error('Debes indicar las equivalencias de notas con letras.');
  const notEvaluatedValue = configuration.notEvaluatedValue.trim().toLocaleUpperCase();
  if (!notEvaluatedValue || notEvaluatedValue.length > 12 || /[\r\n]/.test(notEvaluatedValue)) throw new Error('El valor de no evaluado no es válido.');
  const grades = configuration.grades.map(item => ({ grade: item.grade.trim().toLocaleUpperCase(), from: Number(item.from) }));
  const gradesExplanation = configuration.gradesExplanation === undefined ? undefined : Object.fromEntries(Object.entries(configuration.gradesExplanation).map(([key, value]) => [key.trim().toLocaleUpperCase(), value.trim()]));
  if (gradesExplanation && Object.entries(gradesExplanation).some(([key, value]) => !/^[A-Z]{2}$/.test(key) || !value)) throw new Error('La leyenda de notas no es válida.');
  const hasLetterGrades = configuration.hasLetterGrades && grades.length > 0 && Boolean(gradesExplanation && Object.keys(gradesExplanation).length);
  if (configuration.finalReportGradeMode === 'LETTER' && !hasLetterGrades) throw new Error('Las notas con letras requieren grades y gradesExplanation.');
  const invalidGrades = grades.some(item => !/^[A-Z]{2}[+-]?$/.test(item.grade) || !Number.isFinite(item.from) || item.from < 0 || item.from > 10)
    || grades[0]?.from !== 0
    || grades.some((item, index) => index > 0 && (item.from <= grades[index - 1].from || grades.slice(0, index).some(previous => previous.grade === item.grade)));
  if (configuration.hasLetterGrades && invalidGrades) throw new Error('La tabla de conversión de notas no es válida.');
  return { examWeight, continuousAssessmentWeight, finalReportGradeMode: hasLetterGrades ? configuration.finalReportGradeMode : 'NUMERIC', notEvaluatedValue, grades: hasLetterGrades ? grades : [], gradesExplanation: hasLetterGrades ? gradesExplanation : undefined, hasAssessmentWeights: configuration.hasAssessmentWeights, hasLetterGrades };
};

export const letterGradeForNumericValue = (value: number, grades: readonly GradeConversion[] = DEFAULT_GRADE_CONVERSION) => [...grades].reverse().find(item => value >= item.from)?.grade;

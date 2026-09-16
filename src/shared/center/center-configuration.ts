import type { CenterConfiguration } from '../types/models';

export const DEFAULT_CENTER_CONFIGURATION: CenterConfiguration = {
  examWeight: 70,
  continuousAssessmentWeight: 30,
  finalReportGradeMode: 'NUMERIC',
  grades: [
    { grade: 'NA-', from: 0.0 }, { grade: 'NA', from: 3.0 }, { grade: 'NA+', from: 4.0 },
    { grade: 'AS-', from: 5.0 }, { grade: 'AS', from: 5.5 }, { grade: 'AS+', from: 6.5 },
    { grade: 'AN-', from: 7.0 }, { grade: 'AN', from: 7.5 }, { grade: 'AN+', from: 8.5 },
    { grade: 'AE-', from: 9.0 }, { grade: 'AE', from: 9.5 }, { grade: 'AE+', from: 9.8 }
  ]
};

export const normalizeCenterConfiguration = (configuration: CenterConfiguration): CenterConfiguration => {
  const examWeight = Number(configuration.examWeight); const continuousAssessmentWeight = Number(configuration.continuousAssessmentWeight);
  if (!Number.isFinite(examWeight) || !Number.isFinite(continuousAssessmentWeight) || examWeight < 0 || continuousAssessmentWeight < 0 || examWeight + continuousAssessmentWeight !== 100) throw new Error('Los porcentajes de examen y evaluación continua deben sumar 100.');
  if (configuration.finalReportGradeMode !== 'NUMERIC' && configuration.finalReportGradeMode !== 'LETTER') throw new Error('El formato del informe final debe ser NUMERIC o LETTER.');
  if (!Array.isArray(configuration.grades) || !configuration.grades.length) throw new Error('Debes indicar las equivalencias de notas con letras.');
  const grades = configuration.grades.map(item => ({ grade: item.grade.trim().toLocaleUpperCase(), from: Number(item.from) }));
  if (grades.some(item => !/^[A-Z]{2}[+-]?$/.test(item.grade) || !Number.isFinite(item.from) || item.from < 0 || item.from > 10) || grades[0]?.from !== 0 || grades.some((item, index) => index > 0 && (item.from <= grades[index - 1].from || grades.slice(0, index).some(previous => previous.grade === item.grade)))) throw new Error('La tabla de conversión de notas no es válida.');
  return { examWeight, continuousAssessmentWeight, finalReportGradeMode: configuration.finalReportGradeMode, grades };
};

export const letterGradeForNumericValue = (value: number, grades = DEFAULT_CENTER_CONFIGURATION.grades) => [...grades].reverse().find(item => value >= item.from)?.grade;

export type AssessmentApplicability = 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNRESOLVED';

export function assessmentApplicability(
  date: string,
  periods: readonly { startedOn: string | null; endedOn: string | null }[]
): AssessmentApplicability {
  if (!date) return 'UNRESOLVED';
  return periods.some(period => (period.startedOn === null || period.startedOn <= date) && (period.endedOn === null || date < period.endedOn))
    ? 'APPLICABLE' : 'NOT_APPLICABLE';
}

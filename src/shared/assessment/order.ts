// ISO dates sort chronologically; keep the original order for equal dates.
export function orderAssessments<T extends { assessmentDate?: string }>(columns: readonly T[]): T[] {
  return [...columns].sort((left, right) => {
    const a = left.assessmentDate || '9999-99-99';
    const b = right.assessmentDate || '9999-99-99';
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

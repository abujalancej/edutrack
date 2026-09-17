import type { CenterUpdatePreview, RosterAssignment } from '../types/models';

export const centerUpdateChoiceKey = (courseId: string, name: string) => `${courseId}\u0000${name}`;

export function prepareCenterUpdateConfirmation(preview: CenterUpdatePreview, choices: Record<string, string>, effectiveDate: string) {
  const assignments: RosterAssignment[] = preview.courses.flatMap(course => course.added.map(name => {
    const selected = choices[centerUpdateChoiceKey(course.courseId, name)];
    return { courseId: course.courseId, incomingName: name, studentId: selected && selected !== 'new' ? Number(selected) : null };
  }));
  const unresolved = preview.courses.some(course => course.added.some(name => {
    const selected = choices[centerUpdateChoiceKey(course.courseId, name)];
    if (!selected) return course.ambiguousMatches.some(item => item.name === name);
    return selected !== 'new' && ![...course.removed, ...course.historicalStudents].some(candidate => String(candidate.id) === selected);
  }));
  const selectedIds = assignments.flatMap(item => item.studentId === null ? [] : [item.studentId]);
  const duplicateAssignment = new Set(selectedIds).size !== selectedIds.length;
  const parsedDate = new Date(`${effectiveDate}T00:00:00.000Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === effectiveDate;
  return { assignments, unresolved, duplicateAssignment, validDate,
    canConfirm: !unresolved && !duplicateAssignment && !preview.configurationBlocked && (!preview.rosterChanged || validDate) };
}

import { TRIMESTER_LABELS, isCourseLevel, isTrimester } from '../../shared/catalogs/catalogs';
import type { FullSeguimentExport } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';

export function buildExport(db: AppDatabase, worksheetId: number): FullSeguimentExport {
  const worksheet = db.getWorksheet(worksheetId);
  const teacher = db.getProfile();
  if (!isCourseLevel(worksheet.courseLevel) || !isTrimester(worksheet.trimester) || !db.hasCourse(worksheet.courseLevel) || !db.hasSubject(worksheet.courseLevel, worksheet.subject)) throw new Error('INVALID_WORKSHEET');
  if (!teacher.firstName || !teacher.lastName || !teacher.sex) throw new Error('PROFILE_REQUIRED');
  const enabledStudents = worksheet.students.filter(student => !worksheet.disabledStudentIds.includes(student.id));
  if (enabledStudents.length === 0) throw new Error('STUDENTS_REQUIRED');
  if (!worksheet.isComplete) throw new Error('INCOMPLETE_WORKSHEET');
  const names = new Set<string>();
  for (const student of worksheet.students) {
    const name = student.fullName.toLocaleLowerCase();
    if (names.has(name)) throw new Error('AMBIGUOUS_STUDENT_NAMES');
    names.add(name);
  }
  const version = worksheet.students.some(student => db.listStudentEnrollments(student.id).some(period => period.startedOn !== null) || !worksheet.activeStudentIds.includes(student.id))
    || enabledStudents.some(student => worksheet.columns.some(column => worksheet.applicability[`${student.id}:${column.id}`] === 'NOT_APPLICABLE')) ? 2 : 1;
  return {
    format: 'full-seguiment', version, exportedAt: new Date().toISOString(), teacher,
    course: { level: worksheet.courseLevel, name: db.courseName(worksheet.courseLevel) },
    trimester: { id: worksheet.trimester, name: TRIMESTER_LABELS[worksheet.trimester] },
    subject: { name: worksheet.subject, gradeMode: worksheet.gradeMode, isElective: worksheet.isElective },
    columns: worksheet.columns.map(column => ({ id: column.exportId, name: column.name, kind: column.kind, assessmentDate: column.assessmentDate })),
    students: worksheet.students.map(student => ({
      name: student.fullName,
      enabled: !worksheet.disabledStudentIds.includes(student.id),
      ...(version === 2 ? {
        enrolled: worksheet.activeStudentIds.includes(student.id),
        applicability: Object.fromEntries(worksheet.columns.map(column => [column.exportId, worksheet.applicability[`${student.id}:${column.id}`] as 'APPLICABLE' | 'NOT_APPLICABLE']))
      } : {}),
      values: Object.fromEntries(worksheet.columns.map(column => [column.exportId, worksheet.values[`${student.id}:${column.id}`] ?? ''])),
      observations: Object.fromEntries(worksheet.columns.map(column => [column.exportId, worksheet.observations[`${student.id}:${column.id}`] ?? '']))
    }))
  };
}

export function suggestedFilename(data: FullSeguimentExport) {
  const subject = data.subject.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const course = data.course.level.replace('_', '');
  const trimester = data.trimester.id.replace('_', '');
  const exportDate = data.exportedAt.slice(0, 10).replaceAll('-', '');
  return `${course}_${trimester}_${subject}_${exportDate}.edutrack`;
}

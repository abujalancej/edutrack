import { TRIMESTER_LABELS, isCourseLevel, isTrimester } from '../../shared/catalogs/catalogs';
import type { ImportedWorksheetDetail, TrackingReportsExport } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';

type ResolvedSubject = { name: string; delivery: ImportedWorksheetDetail };

export function buildTrackingReports(db: AppDatabase, reportId: number): TrackingReportsExport {
  const report = db.getTrackingReport(reportId);
  const { courseLevel, trimester } = report;
  if (!isCourseLevel(courseLevel) || !isTrimester(trimester) || !db.hasCourse(courseLevel)) throw new Error('INVALID_REPORT_SELECTION');

  const imported = db.listImports(reportId)
    .filter(item => item.isBlocking)
    .map(item => db.getImportedWorksheet(item.id));
  // Una optativa es una asignatura normal con un subconjunto de alumnado.
  // No se agrupan entregas ni se infiere una asignatura llamada «Optativa».
  const deliveryBySubject = new Map(imported.map(item => [item.subject, item] as const));
  const subjects: ResolvedSubject[] = db.listSubjects(courseLevel).flatMap(subject => {
    const delivery = deliveryBySubject.get(subject.name);
    return delivery ? [{ name: subject.name, delivery }] : [];
  });

  if (subjects.length === 0) throw new Error('NO_IMPORTED_DELIVERIES');

  const tutorObservations = db.listTutorObservations();
  const students = db.listStudents(courseLevel);

  return {
    format: 'edutrack-tracking-reports',
    version: 1,
    generatedAt: new Date().toISOString(),
    language: db.getLanguage(),
    schoolLogo: db.getSchoolLogo() || undefined,
    tutorSex: db.getProfile().sex,
    course: { level: courseLevel, name: db.courseName(courseLevel) },
    trimester: { id: trimester, name: TRIMESTER_LABELS[trimester] },
    report: { sequence: report.sequence },
    subjects: subjects.map(subject => {
      return {
        name: subject.name,
        teacher: subject.delivery.payload.teacher,
        gradeMode: subject.delivery.payload.subject.gradeMode,
        exportedAt: subject.delivery.payload.exportedAt,
        columns: subject.delivery.payload.columns
      };
    }),
    students: students.map(student => ({
      name: student.fullName,
      tutorObservation: tutorObservations[`${reportId}:${student.id}`] ?? '',
      subjects: subjects.map(subject => {
        const importedStudent = subject.delivery.payload.students.find(item => item.name === student.fullName);
        return {
          name: subject.name,
          values: importedStudent?.values ?? {},
          observations: importedStudent?.observations ?? {}
        };
      })
    }))
  };
}

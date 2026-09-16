import { TRIMESTER_LABELS, isCourseLevel, isTrimester } from '../../shared/catalogs/catalogs';
import type { ExportColumn, FullSeguimentExport, ImportedWorksheetDetail, TrackingReportsExport } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';

type ResolvedSubject = { name: string; delivery: ImportedWorksheetDetail };

const columnIdentity = (column: ExportColumn) => `${column.name.trim().toLocaleLowerCase()}|${column.kind ?? 'CONTINUOUS_ASSESSMENT'}`;

const markExistingColumns = (columns: ExportColumn[], previousColumns: ExportColumn[]) => {
  const availablePreviousColumns = [...previousColumns];
  return columns.map(column => {
    const index = availablePreviousColumns.findIndex(previous => previous.id === column.id || columnIdentity(previous) === columnIdentity(column));
    if (index < 0) return { ...column, isExisting: false };
    availablePreviousColumns.splice(index, 1);
    return { ...column, isExisting: true };
  });
};

export function buildTrackingReports(db: AppDatabase, reportId: number): TrackingReportsExport {
  const report = db.getTrackingReport(reportId);
  const { courseLevel, trimester } = report;
  if (!isCourseLevel(courseLevel) || !isTrimester(trimester) || !db.hasCourse(courseLevel)) throw new Error('INVALID_REPORT_SELECTION');

  const imported = db.listImports(reportId)
    .filter(item => item.isBlocking)
    .map(item => db.getImportedWorksheet(item.id));
  const sourceReport = report.sequence > 1
    ? db.listTrackingReports().find(item => item.courseLevel === courseLevel && item.trimester === trimester && item.sequence === report.sequence - 1)
    : undefined;
  const sourceColumnsBySubject = new Map<string, FullSeguimentExport['columns']>();
  if (sourceReport) {
    db.listImports(sourceReport.id).forEach(item => {
      sourceColumnsBySubject.set(item.subject, db.getImportedWorksheet(item.id).payload.columns);
    });
  }
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
    centerConfiguration: db.getCenterConfiguration(),
    tutorSex: db.getProfile().sex,
    course: { level: courseLevel, name: db.courseName(courseLevel) },
    trimester: { id: trimester, name: TRIMESTER_LABELS[trimester] },
    report: { sequence: report.sequence, derivedFromSequence: sourceReport?.sequence },
    subjects: subjects.map(subject => {
      return {
        name: subject.name,
        teacher: subject.delivery.payload.teacher,
        gradeMode: subject.delivery.payload.subject.gradeMode,
        exportedAt: subject.delivery.payload.exportedAt,
        columns: sourceReport ? markExistingColumns(subject.delivery.payload.columns, sourceColumnsBySubject.get(subject.name) ?? []) : subject.delivery.payload.columns
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

import { TRIMESTER_LABELS, isCourseLevel, isTrimester } from '../../shared/catalogs/catalogs';
import type { ExportColumn, FullSeguimentExport, ImportedWorksheetDetail, TrackingReportsExport } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';

type ResolvedSubject = { name: string; delivery: ImportedWorksheetDetail | null };

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

export function buildTrackingReports(db: AppDatabase, reportId: number, reconstruct = false): TrackingReportsExport {
  const frozen = db.getReportSnapshot(reportId);
  if (frozen && !reconstruct) return frozen.payload;
  const report = db.getTrackingReport(reportId);
  const { courseLevel, trimester } = report;
  if (!isCourseLevel(courseLevel) || !isTrimester(trimester) || !db.hasCourse(courseLevel)) throw new Error('INVALID_REPORT_SELECTION');

  const imported = db.listImports(reportId).map(item => db.getImportedWorksheet(item.id));
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
  const excludedNames = new Set(db.listReportSubjectExclusions().filter(item => item.reportId === reportId).map(item => item.subject));
  const orderedNames = [...new Set([...db.listSubjects(courseLevel).map(subject => subject.name), ...imported.map(item => item.subject), ...excludedNames])];
  const subjects: ResolvedSubject[] = orderedNames.flatMap<ResolvedSubject>(name => {
    const delivery = deliveryBySubject.get(name);
    return delivery ? [{ name, delivery }] : excludedNames.has(name) ? [{ name, delivery: null }] : [];
  });

  if (subjects.length === 0 && !reconstruct) throw new Error('NO_IMPORTED_DELIVERIES');

  const tutorObservations = db.listTutorObservations();
  const roster = db.getReportRoster(reportId);
  const students = reconstruct && roster.length === 0 ? db.listStudents(courseLevel).map(student => ({ id: student.id, name: student.fullName })) : roster;
  if (!reconstruct) {
    for (const subject of subjects) {
      if (!subject.delivery) continue;
      const comparison = db.compareDelivery(subject.delivery.payload, roster);
      if (subject.delivery.isStale || !comparison.matches) throw new Error(`Entrega desactualizada (${subject.name}). Altas: ${comparison.missingInFile.join(', ') || 'ninguna'}; bajas: ${comparison.extraInFile.join(', ') || 'ninguna'}. Actualiza el listado y reexporta la entrega.`);
    }
  }

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
        teacher: subject.delivery?.payload.teacher ?? { firstName: '', lastName: '' },
        gradeMode: subject.delivery?.payload.subject.gradeMode,
        exportedAt: subject.delivery?.payload.exportedAt ?? '',
        columns: subject.delivery ? (sourceReport ? markExistingColumns(subject.delivery.payload.columns, sourceColumnsBySubject.get(subject.name) ?? []) : subject.delivery.payload.columns) : [],
        isExcluded: !subject.delivery || !subject.delivery.isBlocking
      };
    }),
    students: students.map(student => ({
      name: student.name,
      tutorObservation: tutorObservations[`${reportId}:${student.id}`] ?? '',
      subjects: subjects.flatMap(subject => {
        if (!subject.delivery) return { name: subject.name, values: {}, observations: {} };
        const importedStudent = subject.delivery.payload.students.find(item => item.name === student.name);
        if (subject.delivery.payload.subject.isElective && importedStudent?.enabled === false) return [];
        if (!importedStudent && !reconstruct) throw new Error(`Falta ${student.name} en la entrega ${subject.name}. Actualiza el listado y reexporta la entrega.`);
        return {
          name: subject.name,
          values: importedStudent?.values ?? {},
          observations: importedStudent?.observations ?? {},
          applicability: importedStudent?.applicability
        };
      })
    }))
  };
}

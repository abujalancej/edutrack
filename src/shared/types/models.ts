import type { CourseLevel, Trimester } from '../catalogs/catalogs';
import type { AssessmentApplicability } from '../assessment/applicability';

export type AppMode = 'teacher' | 'tutor';
export type AppLanguage = 'es' | 'ca' | 'en' | 'eu' | 'gl';
export type AssessmentKind = 'EXAM' | 'CONTINUOUS_ASSESSMENT';
export type GradeMode = 'NUMERIC' | 'LETTER';
export type TeacherSex = 'MALE' | 'FEMALE';
export interface GradeConversion { grade: string; from: number }
export interface CenterConfiguration {
  examWeight: number;
  continuousAssessmentWeight: number;
  finalReportGradeMode: GradeMode;
  notEvaluatedValue: string;
  grades: GradeConversion[];
  gradesExplanation?: Record<string, string>;
  hasAssessmentWeights: boolean;
  hasLetterGrades: boolean;
}
export interface TeacherProfile { firstName: string; lastName: string; sex?: TeacherSex }
export interface ConfiguredCourse { id: CourseLevel; name: string; sortOrder: number }
export interface ConfiguredSubject { courseId: CourseLevel; name: string; sortOrder: number }
export interface Student { id: number; courseLevel: CourseLevel; fullName: string; sortOrder: number }
export interface CenterRosterChange { course: string; added: string[]; removed: string[] }
export interface RosterStudentReference { id: number; name: string }
export interface CourseRosterAnalysis {
  courseId: CourseLevel; courseName: string; status: 'unchanged' | 'changed';
  unchanged: RosterStudentReference[]; added: string[]; removed: RosterStudentReference[];
  possibleNameChanges: { existing: RosterStudentReference[]; incoming: string[] } | null;
  ambiguousMatches: Array<{ name: string; candidates: RosterStudentReference[] }>;
}
export interface CenterRosterAnalysis { revision: string; courses: CourseRosterAnalysis[] }
export interface RosterAssignment { courseId: CourseLevel; incomingName: string; studentId: number | null }
export interface CenterUpdateCoursePreview extends CourseRosterAnalysis {
  isNew: boolean; addedSubjects: string[]; retainedSubjects: string[]; omittedSubjects: string[]; historicalStudents: RosterStudentReference[];
}
export interface CenterUpdatePreview {
  revision: string; courses: CenterUpdateCoursePreview[]; omittedCourses: string[];
  rosterChanged: boolean; configurationChanged: boolean; configurationBlocked: boolean;
}
export interface WorksheetChangeSummary { addedStudents: string[]; removedStudents: string[]; addedAssessments: string[] }
export interface WorksheetSummary { id: number; courseLevel: CourseLevel; trimester: Trimester; subject: string; gradeMode: GradeMode; isElective: boolean; createdAt: string; updatedAt: string; isComplete: boolean; examCount: number; continuousAssessmentCount: number; copiedFromId?: number; changeSummary?: WorksheetChangeSummary }
export interface WorksheetColumn { id: number; worksheetId: number; exportId: string; name: string; kind: AssessmentKind; assessmentDate: string; sortOrder: number; sourceColumnId?: number; studentIds?: number[] }
export interface WorksheetDetail extends WorksheetSummary {
  students: Student[];
  activeStudentIds: number[];
  columns: WorksheetColumn[];
  values: Record<string, string>;
  observations: Record<string, string>;
  applicability: Record<string, AssessmentApplicability>;
  disabledStudentIds: number[];
}
export interface ExportColumn { id: string; name: string; kind?: AssessmentKind; assessmentDate?: string; isExisting?: boolean; isIndividual?: boolean }
export interface ExportStudent { name: string; enabled?: boolean; enrolled?: boolean; values: Record<string, string>; observations?: Record<string, string>; applicability?: Record<string, Exclude<AssessmentApplicability, 'UNRESOLVED'>> }
export interface FullSeguimentExport {
  format: 'full-seguiment'; version: 1 | 2; exportedAt: string;
  teacher: TeacherProfile;
  course: { level: CourseLevel; name: string };
  trimester: { id: Trimester; name: string };
  subject: { name: string; gradeMode?: GradeMode; isElective?: boolean };
  columns: ExportColumn[];
  students: ExportStudent[];
}
export interface TrackingReportSummary {
  id: number; courseLevel: CourseLevel; trimester: Trimester; sequence: number; createdAt: string; updatedAt: string;
  snapshotOrigin?: 'issued' | 'reconstructed';
}
export interface ImportedWorksheetSummary {
  id: number; reportId: number; courseLevel: CourseLevel; trimester: Trimester; subject: string;
  teacherFirstName: string; teacherLastName: string; exportedAt: string; importedAt: string; isElective: boolean; enabledStudentNames: string[];
  gradedStudentNames: string[]; isBlocking: boolean; isStale: boolean;
}
export interface ImportedWorksheetDetail extends ImportedWorksheetSummary { payload: FullSeguimentExport }
export interface ReportSubjectExclusion { reportId: number; subject: string }
export interface TrackingReportsExport {
  format: 'edutrack-tracking-reports'; version: 1; generatedAt: string;
  language: AppLanguage; schoolLogo?: string; tutorSex?: TeacherSex;
  centerConfiguration: CenterConfiguration;
  course: { level: CourseLevel; name: string };
  trimester: { id: Trimester; name: string };
  report: { sequence: number; derivedFromSequence?: number };
  subjects: Array<{
    name: string; teacher: TeacherProfile; gradeMode?: GradeMode; exportedAt: string; columns: ExportColumn[]; isExcluded?: boolean;
  }>;
  students: Array<{
    name: string; tutorObservation: string;
    subjects: Array<{ name: string; values: Record<string, string>; observations: Record<string, string>; applicability?: Record<string, 'APPLICABLE' | 'NOT_APPLICABLE'> }>;
  }>;
}
export interface InitialState {
  profile: TeacherProfile; language: AppLanguage; schoolLogo: string; centerConfiguration: CenterConfiguration; courses: ConfiguredCourse[]; subjects: ConfiguredSubject[];
  students: Student[]; worksheets: WorksheetSummary[]; trackingReports: TrackingReportSummary[]; imports: ImportedWorksheetSummary[]; reportSubjectExclusions: ReportSubjectExclusion[]; tutorObservations: Record<string, string>;
}
export type ImportAnalysis =
  | { path: string; ok: true; data: FullSeguimentExport; duplicate: boolean }
  | { path: string; ok: false; error: string; missingInFile?: string[]; extraInFile?: string[]; matches?: boolean };
export type WorksheetFileAnalysis =
  | { ok: true; data: FullSeguimentExport; duplicate: boolean }
  | { ok: false; cancelled?: boolean; error?: string };
export type RosterFileAnalysis =
  | { path: string; ok: true; names: string[] }
  | { path: string; ok: false; error: string };

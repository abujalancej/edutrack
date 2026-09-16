import type { CourseLevel, Trimester } from '../catalogs/catalogs';

export type AppMode = 'teacher' | 'tutor';
export type AppLanguage = 'es' | 'ca' | 'en' | 'eu' | 'gl';
export type AssessmentKind = 'EXAM' | 'CONTINUOUS_ASSESSMENT';
export type GradeMode = 'NUMERIC' | 'LETTER';
export type TeacherSex = 'MALE' | 'FEMALE';
export interface TeacherProfile { firstName: string; lastName: string; sex?: TeacherSex }
export interface ConfiguredCourse { id: CourseLevel; name: string; sortOrder: number }
export interface ConfiguredSubject { courseId: CourseLevel; name: string; sortOrder: number }
export interface Student { id: number; courseLevel: CourseLevel; fullName: string; sortOrder: number }
export interface WorksheetSummary { id: number; courseLevel: CourseLevel; trimester: Trimester; subject: string; gradeMode: GradeMode; isElective: boolean; createdAt: string; updatedAt: string; isComplete: boolean; examCount: number; continuousAssessmentCount: number }
export interface WorksheetColumn { id: number; worksheetId: number; exportId: string; name: string; kind: AssessmentKind; assessmentDate: string; sortOrder: number }
export interface WorksheetDetail extends WorksheetSummary {
  students: Student[];
  columns: WorksheetColumn[];
  values: Record<string, string>;
  observations: Record<string, string>;
  disabledStudentIds: number[];
}
export interface ExportColumn { id: string; name: string; kind?: AssessmentKind; assessmentDate?: string }
export interface ExportStudent { name: string; enabled?: boolean; values: Record<string, string>; observations?: Record<string, string> }
export interface FullSeguimentExport {
  format: 'full-seguiment'; version: 1; exportedAt: string;
  teacher: TeacherProfile;
  course: { level: CourseLevel; name: string };
  trimester: { id: Trimester; name: string };
  subject: { name: string; gradeMode?: GradeMode; isElective?: boolean };
  columns: ExportColumn[];
  students: ExportStudent[];
}
export interface TrackingReportSummary {
  id: number; courseLevel: CourseLevel; trimester: Trimester; sequence: number; createdAt: string; updatedAt: string;
}
export interface ImportedWorksheetSummary {
  id: number; reportId: number; courseLevel: CourseLevel; trimester: Trimester; subject: string;
  teacherFirstName: string; teacherLastName: string; exportedAt: string; importedAt: string; isElective: boolean; enabledStudentNames: string[];
  gradedStudentNames: string[]; isBlocking: boolean;
}
export interface ImportedWorksheetDetail extends ImportedWorksheetSummary { payload: FullSeguimentExport }
export interface TrackingReportsExport {
  format: 'edutrack-tracking-reports'; version: 1; generatedAt: string;
  language: AppLanguage; schoolLogo?: string; tutorSex?: TeacherSex;
  course: { level: CourseLevel; name: string };
  trimester: { id: Trimester; name: string };
  report: { sequence: number };
  subjects: Array<{
    name: string; teacher: TeacherProfile; gradeMode?: GradeMode; exportedAt: string; columns: ExportColumn[];
  }>;
  students: Array<{
    name: string; tutorObservation: string;
    subjects: Array<{ name: string; values: Record<string, string>; observations: Record<string, string> }>;
  }>;
}
export interface InitialState {
  profile: TeacherProfile; language: AppLanguage; schoolLogo: string; courses: ConfiguredCourse[]; subjects: ConfiguredSubject[];
  students: Student[]; worksheets: WorksheetSummary[]; trackingReports: TrackingReportSummary[]; imports: ImportedWorksheetSummary[]; tutorObservations: Record<string, string>;
}
export type ImportAnalysis =
  | { path: string; ok: true; data: FullSeguimentExport; duplicate: boolean }
  | { path: string; ok: false; error: string; missingInFile?: string[]; extraInFile?: string[]; matches?: boolean };
export type RosterFileAnalysis =
  | { path: string; ok: true; names: string[] }
  | { path: string; ok: false; error: string };

import type { CourseLevel, Trimester } from '../catalogs/catalogs';
import type { AssessmentKind, GradeMode } from './models';
import type { AppLanguage, CenterConfiguration, ConfiguredCourse, ConfiguredSubject, FullSeguimentExport, ImportedWorksheetDetail, ImportedWorksheetSummary, ImportAnalysis, InitialState, RosterFileAnalysis, Student, TeacherProfile, TrackingReportSummary, WorksheetDetail, WorksheetSummary } from './models';

export interface OperationResult { ok: boolean; code?: string; error?: string; replaced?: boolean; count?: number }

export interface FullSeguimentApi {
  getInitialState(): Promise<InitialState>;
  saveLanguage(language: AppLanguage): Promise<AppLanguage>;
  saveProfile(profile: TeacherProfile): Promise<TeacherProfile>;
  importCenterData(): Promise<{ ok: boolean; courses?: ConfiguredCourse[]; subjects?: ConfiguredSubject[]; students?: Student[]; centerConfiguration?: CenterConfiguration; error?: string; cancelled?: boolean }>;
  clearCenterData(): Promise<void>;
  importCourses(): Promise<{ ok: boolean; courses?: ConfiguredCourse[]; error?: string; cancelled?: boolean }>;
  importSubjects(): Promise<{ ok: boolean; subjects?: ConfiguredSubject[]; error?: string; cancelled?: boolean }>;
  chooseSchoolLogo(): Promise<{ ok: boolean; logo?: string; error?: string; cancelled?: boolean }>;
  removeSchoolLogo(): Promise<void>;
  addStudent(course: CourseLevel, name: string): Promise<Student>;
  updateStudent(id: number, name: string): Promise<Student>;
  deleteStudent(id: number): Promise<void>;
  reorderStudents(course: CourseLevel, ids: number[]): Promise<Student[]>;
  chooseRosterFile(): Promise<string | null>;
  analyzeRosterFile(path: string): Promise<RosterFileAnalysis>;
  replaceCourseRoster(course: CourseLevel, names: string[]): Promise<Student[]>;
  createWorksheet(input: { courseLevel: CourseLevel; trimester: Trimester; subject: string; gradeMode: GradeMode; isElective: boolean }): Promise<WorksheetSummary>;
  configureElectiveStudents(worksheetId: number, enabledStudentIds: number[]): Promise<WorksheetDetail>;
  deleteWorksheet(id: number): Promise<void>;
  getWorksheet(id: number): Promise<WorksheetDetail>;
  addAssessment(input: { worksheetId: number; kind: AssessmentKind; name: string; assessmentDate: string }): Promise<WorksheetDetail>;
  renameColumn(id: number, name: string): Promise<void>;
  updateAssessment(id: number, input: { kind: AssessmentKind; name: string; assessmentDate: string }): Promise<void>;
  deleteColumn(id: number): Promise<void>;
  saveCell(worksheetId: number, studentId: number, columnId: number, field: 'grade' | 'observation', value: string): Promise<void>;
  clearAssessmentValues(worksheetId: number, columnId: number): Promise<void>;
  exportWorksheet(id: number): Promise<OperationResult>;
  chooseImportFiles(): Promise<string[]>;
  getDroppedFilePath(file: File): string;
  analyzeImports(paths: string[]): Promise<ImportAnalysis[]>;
  commitImport(data: FullSeguimentExport): Promise<OperationResult>;
  getImportedWorksheet(id: number): Promise<ImportedWorksheetDetail>;
  setImportedWorksheetBlocking(id: number, isBlocking: boolean): Promise<ImportedWorksheetSummary>;
  deleteImportedWorksheet(id: number): Promise<void>;
  saveTutorObservation(reportId: number, studentId: number, observation: string): Promise<void>;
  copyTrackingReport(reportId: number): Promise<TrackingReportSummary>;
  exportTrackingReports(reportId: number): Promise<OperationResult>;
  deleteTrackingReport(reportId: number): Promise<void>;
}

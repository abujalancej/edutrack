import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { COURSE_LABELS, COURSE_LEVELS, normalizeTrimester, SUBJECTS_BY_COURSE, TRIMESTER_LABELS, type CourseLevel, type Trimester } from '../../shared/catalogs/catalogs';
import { DEFAULT_CENTER_CONFIGURATION, normalizeCenterConfiguration } from '../../shared/center/center-configuration';
import { isCompleteGradeValue, normalizeGradeValue } from '../../shared/grades/grades';
import { assessmentApplicability } from '../../shared/assessment/applicability';
import { compareDeliveryRoster, deliveryRosterError } from '../import/delivery-roster';
import { buildTrackingReports } from '../export/tracking-report-service';
import { buildStudentReportHtml } from '../export/student-report-pdf-service';
import type { AppLanguage, AssessmentKind, CenterConfiguration, CenterRosterChange, CenterRosterAnalysis, CenterUpdatePreview, ConfiguredCourse, ConfiguredSubject, CourseRosterAnalysis, FullSeguimentExport, GradeMode, ImportedWorksheetDetail, ImportedWorksheetSummary, InitialState, ReportSubjectExclusion, RosterAssignment, RosterStudentReference, Student, TeacherProfile, TrackingReportSummary, TrackingReportsExport, WorksheetChangeSummary, WorksheetDetail, WorksheetSummary } from '../../shared/types/models';

type Row = Record<string, any>;

// Null start means the enrollment predates this history; end is the first inactive day.
export interface StudentEnrollment { id: number; studentId: number; startedOn: string | null; endedOn: string | null }
export type { CenterRosterAnalysis, CenterUpdatePreview, CourseRosterAnalysis, RosterAssignment, RosterStudentReference } from '../../shared/types/models';

const strictDate = (value: string) => {
  const timestamp = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== value) {
    throw new Error('La fecha efectiva debe ser una fecha válida en formato AAAA-MM-DD.');
  }
};

const uniqueRosterNames = (names: string[], courseName: string) => {
  const cleaned = names.map(name => name.trim());
  if (cleaned.some(name => !name)) throw new Error(`Hay un nombre de alumno vacío en “${courseName}”.`);
  const seen = new Set<string>();
  for (const name of cleaned) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Nombre de alumno duplicado en “${courseName}”: ${name}.`);
    seen.add(key);
  }
  return cleaned;
};

export class CenterRosterChangeError extends Error {
  constructor(readonly changes: CenterRosterChange[]) {
    super(`El listado de alumnos ha cambiado: ${changes.map(change => `${change.course} — altas: ${change.added.join(', ') || 'ninguna'}; bajas: ${change.removed.join(', ') || 'ninguna'}`).join(' | ')}`);
    this.name = 'CenterRosterChangeError';
  }
}

const rosterDifference = (current: string[], incoming: string[]) => {
  const count = (names: string[]) => names.reduce<Map<string, number>>((result, name) => result.set(name, (result.get(name) ?? 0) + 1), new Map());
  const currentCounts = count(current); const incomingCounts = count(incoming);
  const added = incoming.filter(name => { const remaining = currentCounts.get(name) ?? 0; if (remaining) currentCounts.set(name, remaining - 1); return !remaining; });
  const removed = current.filter(name => { const remaining = incomingCounts.get(name) ?? 0; if (remaining) incomingCounts.set(name, remaining - 1); return !remaining; });
  return { added, removed };
};

const configurationFingerprint = (configuration: CenterConfiguration) => {
  const normalized = normalizeCenterConfiguration(configuration);
  return JSON.stringify({ ...normalized, gradesExplanation: Object.entries(normalized.gradesExplanation ?? {}).sort(([left], [right]) => left.localeCompare(right)) });
};

const isCompleteImportedGrade = (value: string, mode: GradeMode, grades: CenterConfiguration['grades'], notEvaluatedValue: string) => {
  return isCompleteGradeValue(value, mode, grades, notEvaluatedValue);
};

const normalizeImportedNumericGrades = (data: FullSeguimentExport): FullSeguimentExport => {
  if (data.subject.gradeMode !== 'NUMERIC') return data;
  return {
    ...data,
    students: data.students.map(student => ({
      ...student,
      values: Object.fromEntries(Object.entries(student.values).map(([columnId, value]) => [columnId, normalizeGradeValue(value)]))
    }))
  };
};

export class AppDatabase {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    const reconstructLegacyReports = !(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_snapshots'").get());
    let backfillCopiedDeliveries = false;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teacher_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1), first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
        sex TEXT NOT NULL DEFAULT 'MALE'
      );
      INSERT OR IGNORE INTO teacher_profile (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS app_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1), language TEXT NOT NULL DEFAULT 'es', school_logo TEXT NOT NULL DEFAULT '',
        exam_weight REAL NOT NULL DEFAULT 0, continuous_assessment_weight REAL NOT NULL DEFAULT 0,
        final_report_grade_mode TEXT NOT NULL DEFAULT 'NUMERIC', not_evaluated_value TEXT NOT NULL DEFAULT '-', grades_json TEXT NOT NULL DEFAULT '[]', grades_explanation_json TEXT NOT NULL DEFAULT '{}',
        has_assessment_weights INTEGER NOT NULL DEFAULT 0, has_letter_grades INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO app_preferences (id, language) VALUES (1, 'es');
      CREATE TABLE IF NOT EXISTS configured_courses (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS configured_subjects (
        course_id TEXT NOT NULL REFERENCES configured_courses(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY(course_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_configured_subjects_course ON configured_subjects(course_id, sort_order);
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT, course_level TEXT NOT NULL, full_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_students_course ON students(course_level, sort_order);
      CREATE TABLE IF NOT EXISTS worksheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, course_level TEXT NOT NULL, trimester TEXT NOT NULL, subject TEXT NOT NULL,
        grade_mode TEXT NOT NULL DEFAULT 'NUMERIC', is_elective INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, copied_from_id INTEGER, roster_snapshot_json TEXT,
        UNIQUE(course_level, trimester, subject)
      );
      CREATE TABLE IF NOT EXISTS worksheet_disabled_students (
        worksheet_id INTEGER NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        PRIMARY KEY (worksheet_id, student_id)
      );
      CREATE TABLE IF NOT EXISTS worksheet_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, worksheet_id INTEGER NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
        export_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'CONTINUOUS_ASSESSMENT',
        assessment_date TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL, source_column_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS worksheet_values (
        worksheet_id INTEGER NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        column_id INTEGER NOT NULL REFERENCES worksheet_columns(id) ON DELETE CASCADE,
        value TEXT NOT NULL, observation TEXT NOT NULL DEFAULT '', PRIMARY KEY (worksheet_id, student_id, column_id)
      );
      CREATE TABLE IF NOT EXISTS worksheet_applicability_overrides (
        worksheet_id INTEGER NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        column_id INTEGER NOT NULL REFERENCES worksheet_columns(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('APPLICABLE', 'NOT_APPLICABLE')),
        PRIMARY KEY (worksheet_id, student_id, column_id)
      );
      CREATE TABLE IF NOT EXISTS tracking_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, course_level TEXT NOT NULL, trimester TEXT NOT NULL,
        report_number INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, roster_snapshot_json TEXT,
        UNIQUE(course_level, trimester, report_number)
      );
      CREATE TABLE IF NOT EXISTS report_snapshots (
        report_id INTEGER PRIMARY KEY REFERENCES tracking_reports(id) ON DELETE CASCADE,
        origin TEXT NOT NULL CHECK (origin IN ('issued', 'reconstructed')),
        captured_at TEXT NOT NULL, payload_json TEXT NOT NULL, html_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS imported_worksheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
        course_level TEXT NOT NULL, trimester TEXT NOT NULL, subject TEXT NOT NULL,
        teacher_first_name TEXT NOT NULL, teacher_last_name TEXT NOT NULL, exported_at TEXT NOT NULL,
        imported_at TEXT NOT NULL, payload_json TEXT NOT NULL, is_elective INTEGER NOT NULL DEFAULT 0, is_blocking INTEGER NOT NULL DEFAULT 1, is_stale INTEGER NOT NULL DEFAULT 0,
        UNIQUE(report_id, subject)
      );
      CREATE TABLE IF NOT EXISTS report_subject_exclusions (
        report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        PRIMARY KEY (report_id, subject)
      );
      CREATE TABLE IF NOT EXISTS tutor_observations (
        report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        observation TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (report_id, student_id)
      );
    `);
    const columnInfo = this.db.prepare('PRAGMA table_info(worksheet_columns)').all() as Row[];
    if (!columnInfo.some(column => column.name === 'student_ids_json')) this.db.exec('ALTER TABLE worksheet_columns ADD COLUMN student_ids_json TEXT');
    if (!columnInfo.some(column => column.name === 'kind')) this.db.exec("ALTER TABLE worksheet_columns ADD COLUMN kind TEXT NOT NULL DEFAULT 'CONTINUOUS_ASSESSMENT'");
    if (!columnInfo.some(column => column.name === 'assessment_date')) this.db.exec("ALTER TABLE worksheet_columns ADD COLUMN assessment_date TEXT NOT NULL DEFAULT ''");
    const valueInfo = this.db.prepare('PRAGMA table_info(worksheet_values)').all() as Row[];
    if (!valueInfo.some(column => column.name === 'observation')) this.db.exec("ALTER TABLE worksheet_values ADD COLUMN observation TEXT NOT NULL DEFAULT ''");
    const preferenceInfo = this.db.prepare('PRAGMA table_info(app_preferences)').all() as Row[];
    if (!preferenceInfo.some(column => column.name === 'school_logo')) this.db.exec("ALTER TABLE app_preferences ADD COLUMN school_logo TEXT NOT NULL DEFAULT ''");
    if (!preferenceInfo.some(column => column.name === 'exam_weight')) this.db.exec('ALTER TABLE app_preferences ADD COLUMN exam_weight REAL NOT NULL DEFAULT 0');
    if (!preferenceInfo.some(column => column.name === 'continuous_assessment_weight')) this.db.exec('ALTER TABLE app_preferences ADD COLUMN continuous_assessment_weight REAL NOT NULL DEFAULT 0');
    if (!preferenceInfo.some(column => column.name === 'final_report_grade_mode')) this.db.exec("ALTER TABLE app_preferences ADD COLUMN final_report_grade_mode TEXT NOT NULL DEFAULT 'NUMERIC'");
    if (!preferenceInfo.some(column => column.name === 'not_evaluated_value')) this.db.exec("ALTER TABLE app_preferences ADD COLUMN not_evaluated_value TEXT NOT NULL DEFAULT '-'");
    if (!preferenceInfo.some(column => column.name === 'grades_json')) this.db.exec("ALTER TABLE app_preferences ADD COLUMN grades_json TEXT NOT NULL DEFAULT '[]'");
    if (!preferenceInfo.some(column => column.name === 'grades_explanation_json')) this.db.exec("ALTER TABLE app_preferences ADD COLUMN grades_explanation_json TEXT NOT NULL DEFAULT '{}'");
    if (!preferenceInfo.some(column => column.name === 'has_assessment_weights')) this.db.exec('ALTER TABLE app_preferences ADD COLUMN has_assessment_weights INTEGER NOT NULL DEFAULT 0');
    if (!preferenceInfo.some(column => column.name === 'has_letter_grades')) this.db.exec('ALTER TABLE app_preferences ADD COLUMN has_letter_grades INTEGER NOT NULL DEFAULT 0');
    const worksheetInfo = this.db.prepare('PRAGMA table_info(worksheets)').all() as Row[];
    if (!worksheetInfo.some(column => column.name === 'grade_mode')) this.db.exec("ALTER TABLE worksheets ADD COLUMN grade_mode TEXT NOT NULL DEFAULT 'NUMERIC'");
    if (!worksheetInfo.some(column => column.name === 'is_elective')) this.db.exec('ALTER TABLE worksheets ADD COLUMN is_elective INTEGER NOT NULL DEFAULT 0');
    if (!worksheetInfo.some(column => column.name === 'copied_from_id')) this.db.exec('ALTER TABLE worksheets ADD COLUMN copied_from_id INTEGER');
    if (!worksheetInfo.some(column => column.name === 'roster_snapshot_json')) this.db.exec('ALTER TABLE worksheets ADD COLUMN roster_snapshot_json TEXT');
    const currentWorksheetInfo = this.db.prepare('PRAGMA table_info(worksheets)').all() as Row[];
    if (currentWorksheetInfo.some(column => column.name === 'roster_snapshot_json')) this.db.prepare(`UPDATE worksheets SET roster_snapshot_json = (SELECT json_group_array(full_name) FROM students WHERE students.course_level = worksheets.course_level ORDER BY sort_order) WHERE roster_snapshot_json IS NULL`).run();
    const worksheetColumnInfo = this.db.prepare('PRAGMA table_info(worksheet_columns)').all() as Row[];
    if (!worksheetColumnInfo.some(column => column.name === 'source_column_id')) this.db.exec('ALTER TABLE worksheet_columns ADD COLUMN source_column_id INTEGER');
    let importInfo = this.db.prepare('PRAGMA table_info(imported_worksheets)').all() as Row[];
    if (!importInfo.some(column => column.name === 'is_elective')) { this.db.exec('ALTER TABLE imported_worksheets ADD COLUMN is_elective INTEGER NOT NULL DEFAULT 0'); importInfo = this.db.prepare('PRAGMA table_info(imported_worksheets)').all() as Row[]; }
    if (!importInfo.some(column => column.name === 'is_blocking')) { this.db.exec('ALTER TABLE imported_worksheets ADD COLUMN is_blocking INTEGER NOT NULL DEFAULT 1'); importInfo = this.db.prepare('PRAGMA table_info(imported_worksheets)').all() as Row[]; }
    if (!importInfo.some(column => column.name === 'report_id')) {
      this.db.exec(`
        INSERT OR IGNORE INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at)
          SELECT course_level, trimester, 1, MIN(imported_at), MAX(imported_at) FROM imported_worksheets GROUP BY course_level, trimester;
        CREATE TABLE imported_worksheets_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
          course_level TEXT NOT NULL, trimester TEXT NOT NULL, subject TEXT NOT NULL,
          teacher_first_name TEXT NOT NULL, teacher_last_name TEXT NOT NULL, exported_at TEXT NOT NULL,
          imported_at TEXT NOT NULL, payload_json TEXT NOT NULL, is_elective INTEGER NOT NULL DEFAULT 0, is_blocking INTEGER NOT NULL DEFAULT 1,
          UNIQUE(report_id, subject)
        );
        INSERT INTO imported_worksheets_v2(id, report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective, is_blocking)
          SELECT i.id, r.id, i.course_level, i.trimester, i.subject, i.teacher_first_name, i.teacher_last_name, i.exported_at, i.imported_at, i.payload_json, i.is_elective, i.is_blocking
          FROM imported_worksheets i JOIN tracking_reports r ON r.course_level=i.course_level AND r.trimester=i.trimester AND r.report_number=1;
        DROP TABLE imported_worksheets;
        ALTER TABLE imported_worksheets_v2 RENAME TO imported_worksheets;
      `);
    }
    importInfo = this.db.prepare('PRAGMA table_info(imported_worksheets)').all() as Row[];
    if (!importInfo.some(column => column.name === 'is_stale')) { this.db.exec('ALTER TABLE imported_worksheets ADD COLUMN is_stale INTEGER NOT NULL DEFAULT 0'); backfillCopiedDeliveries = true; }
    const observationInfo = this.db.prepare('PRAGMA table_info(tutor_observations)').all() as Row[];
    if (!observationInfo.some(column => column.name === 'report_id')) {
      this.db.exec(`
        INSERT OR IGNORE INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at)
          SELECT course_level, trimester, 1, MIN(updated_at), MAX(updated_at) FROM tutor_observations GROUP BY course_level, trimester;
        CREATE TABLE tutor_observations_v2 (
          report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          observation TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (report_id, student_id)
        );
        INSERT INTO tutor_observations_v2(report_id, student_id, observation, updated_at)
          SELECT r.id, o.student_id, o.observation, o.updated_at FROM tutor_observations o
          JOIN tracking_reports r ON r.course_level=o.course_level AND r.trimester=o.trimester AND r.report_number=1;
        DROP TABLE tutor_observations;
        ALTER TABLE tutor_observations_v2 RENAME TO tutor_observations;
      `);
    }
    const profileInfo = this.db.prepare('PRAGMA table_info(teacher_profile)').all() as Row[];
    if (!profileInfo.some(column => column.name === 'sex')) this.db.exec("ALTER TABLE teacher_profile ADD COLUMN sex TEXT NOT NULL DEFAULT 'MALE'");
    const trackingInfo = this.db.prepare('PRAGMA table_info(tracking_reports)').all() as Row[];
    if (!trackingInfo.some(column => column.name === 'roster_snapshot_json')) this.db.exec('ALTER TABLE tracking_reports ADD COLUMN roster_snapshot_json TEXT');
    for (const [legacy, current] of [['TRIMESTER_1', 'T_1'], ['TRIMESTER_2', 'T_2'], ['TRIMESTER_3', 'T_3']]) {
      this.db.prepare('UPDATE worksheets SET trimester = ? WHERE trimester = ?').run(current, legacy);
      this.db.prepare('UPDATE imported_worksheets SET trimester = ? WHERE trimester = ?').run(current, legacy);
      this.db.prepare('UPDATE tracking_reports SET trimester = ? WHERE trimester = ?').run(current, legacy);
    }
    if ((this.db.prepare('SELECT COUNT(*) count FROM configured_courses').get() as Row).count === 0) {
      const referenced = (this.db.prepare(`SELECT course_level FROM students UNION SELECT course_level FROM worksheets UNION SELECT course_level FROM imported_worksheets`).all() as Row[]).map(row => row.course_level as string);
      const addCourse = this.db.prepare('INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?)');
      const addSubject = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
      this.transaction(() => referenced.forEach((courseId, courseIndex) => {
        addCourse.run(courseId, COURSE_LABELS[courseId] ?? courseId, courseIndex);
        const used = (this.db.prepare('SELECT DISTINCT subject FROM worksheets WHERE course_level = ?').all(courseId) as Row[]).map(row => row.subject as string);
        const subjects = [...new Set([...(SUBJECTS_BY_COURSE[courseId] ?? []), ...used])];
        subjects.forEach((subject, subjectIndex) => addSubject.run(courseId, subject, subjectIndex));
      }));
    }
    this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS student_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        started_on TEXT,
        ended_on TEXT,
        CHECK (started_on IS NULL OR ended_on IS NULL OR started_on < ended_on)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_student_enrollments_active ON student_enrollments(student_id) WHERE ended_on IS NULL;
      CREATE INDEX IF NOT EXISTS idx_student_enrollments_student ON student_enrollments(student_id, id);
      CREATE TRIGGER IF NOT EXISTS students_open_initial_enrollment AFTER INSERT ON students
      BEGIN INSERT INTO student_enrollments(student_id, started_on, ended_on) VALUES (NEW.id, NULL, NULL); END;`);
      this.db.exec(`INSERT INTO student_enrollments(student_id, started_on, ended_on)
        SELECT id, NULL, NULL FROM students
        WHERE NOT EXISTS (SELECT 1 FROM student_enrollments WHERE student_id = students.id)`);
    });
    if (reconstructLegacyReports) {
      for (const row of this.db.prepare('SELECT id, course_level, trimester, report_number, created_at FROM tracking_reports').all() as Row[]) {
        const deliveries = this.db.prepare('SELECT payload_json FROM imported_worksheets WHERE report_id = ? ORDER BY imported_at').all(row.id) as Row[];
        const names = [...new Set(deliveries.flatMap(delivery => {
          try {
            const payload = JSON.parse(delivery.payload_json) as FullSeguimentExport;
            return payload.students.filter(student => payload.version === 1 || student.enrolled !== false).map(student => student.name);
          } catch { return []; }
        }))];
        const localStudents = this.listStudents(row.course_level);
        const roster = names.length
          ? names.map((name, index) => ({ id: localStudents.filter(student => student.fullName === name).length === 1 ? localStudents.find(student => student.fullName === name)!.id : -index - 1, name }))
          : this.listActiveStudents(row.course_level).map(student => ({ id: student.id, name: student.fullName }));
        this.db.prepare('UPDATE tracking_reports SET roster_snapshot_json = ? WHERE id = ? AND roster_snapshot_json IS NULL').run(JSON.stringify(roster), row.id);
        let payload: TrackingReportsExport;
        try { payload = buildTrackingReports(this, row.id, true); }
        catch {
          // Preserve the roster and available tutor notes even if an old delivery cannot be parsed.
          const notes = this.listTutorObservations();
          payload = {
            format: 'edutrack-tracking-reports', version: 1, generatedAt: row.created_at,
            language: this.getLanguage(), schoolLogo: this.getSchoolLogo() || undefined,
            centerConfiguration: this.getCenterConfiguration(), tutorSex: this.getProfile().sex,
            course: { level: row.course_level, name: this.courseName(row.course_level) },
            trimester: { id: row.trimester, name: TRIMESTER_LABELS[row.trimester as Trimester] ?? row.trimester },
            report: { sequence: row.report_number }, subjects: [],
            students: roster.map(student => ({ name: student.name, tutorObservation: notes[`${row.id}:${student.id}`] ?? '', subjects: [] }))
          };
        }
        this.insertSnapshot(row.id, 'reconstructed', payload, payload.students.map((_, index) => buildStudentReportHtml(payload, index)));
      }
    }
    if (backfillCopiedDeliveries) {
      const reports = this.listTrackingReports();
      for (const report of reports.filter(item => item.sequence > 1)) {
        const source = reports.find(item => item.courseLevel === report.courseLevel && item.trimester === report.trimester && item.sequence === report.sequence - 1);
        if (!source) continue;
        const ids = (id: number) => this.getReportRoster(id).map(student => student.id).sort((left, right) => left - right);
        if (JSON.stringify(ids(source.id)) !== JSON.stringify(ids(report.id))) {
          this.db.prepare('UPDATE imported_worksheets SET is_stale = 1 WHERE report_id = ? AND imported_at = ?').run(report.id, report.createdAt);
        }
      }
    }
    this.db.exec('PRAGMA optimize');
  }

  close() { this.db.close(); }
  private now() { return new Date().toISOString(); }

  getProfile(): TeacherProfile {
    const row = this.db.prepare('SELECT first_name, last_name, sex FROM teacher_profile WHERE id = 1').get() as Row;
    return { firstName: row.first_name, lastName: row.last_name, sex: row.sex === 'FEMALE' ? 'FEMALE' : 'MALE' };
  }

  saveProfile(profile: TeacherProfile): TeacherProfile {
    this.db.prepare('UPDATE teacher_profile SET first_name = ?, last_name = ?, sex = ? WHERE id = 1')
      .run(profile.firstName.trim(), profile.lastName.trim(), profile.sex === 'FEMALE' ? 'FEMALE' : 'MALE');
    return this.getProfile();
  }

  getLanguage(): AppLanguage {
    const value = (this.db.prepare('SELECT language FROM app_preferences WHERE id = 1').get() as Row).language;
    return ['es', 'ca', 'en', 'eu', 'gl'].includes(value) ? value : 'es';
  }

  saveLanguage(language: AppLanguage): AppLanguage {
    if (!['es', 'ca', 'en', 'eu', 'gl'].includes(language)) throw new Error('Idioma no válido.');
    this.db.prepare('UPDATE app_preferences SET language = ? WHERE id = 1').run(language);
    return language;
  }

  getSchoolLogo() { return (this.db.prepare('SELECT school_logo FROM app_preferences WHERE id = 1').get() as Row).school_logo as string; }
  saveSchoolLogo(logo: string) { this.db.prepare('UPDATE app_preferences SET school_logo = ? WHERE id = 1').run(logo); }
  getCenterConfiguration(): CenterConfiguration {
    const row = this.db.prepare('SELECT exam_weight, continuous_assessment_weight, final_report_grade_mode, not_evaluated_value, grades_json, grades_explanation_json, has_assessment_weights, has_letter_grades FROM app_preferences WHERE id = 1').get() as Row;
    const examWeight = Number(row.exam_weight); const continuousAssessmentWeight = Number(row.continuous_assessment_weight);
    try { return normalizeCenterConfiguration({ examWeight, continuousAssessmentWeight, finalReportGradeMode: row.final_report_grade_mode === 'LETTER' ? 'LETTER' : 'NUMERIC', notEvaluatedValue: row.not_evaluated_value ?? '-', grades: JSON.parse(row.grades_json || '[]'), gradesExplanation: JSON.parse(row.grades_explanation_json || '{}'), hasAssessmentWeights: Boolean(row.has_assessment_weights), hasLetterGrades: Boolean(row.has_letter_grades) }); }
    catch { return structuredClone(DEFAULT_CENTER_CONFIGURATION); }
  }
  saveCenterConfiguration(configuration: CenterConfiguration) {
    const { examWeight, continuousAssessmentWeight, finalReportGradeMode, notEvaluatedValue, grades, gradesExplanation, hasAssessmentWeights, hasLetterGrades } = normalizeCenterConfiguration(configuration);
    if (this.db.prepare('SELECT 1 FROM tracking_reports r LEFT JOIN report_snapshots s ON s.report_id = r.id WHERE s.report_id IS NULL LIMIT 1').get() && configurationFingerprint(configuration) !== configurationFingerprint(this.getCenterConfiguration())) {
      throw new Error('No se puede cambiar la configuración de notas mientras existan informes de seguimiento.');
    }
    this.db.prepare('UPDATE app_preferences SET exam_weight = ?, continuous_assessment_weight = ?, final_report_grade_mode = ?, not_evaluated_value = ?, grades_json = ?, grades_explanation_json = ?, has_assessment_weights = ?, has_letter_grades = ? WHERE id = 1').run(examWeight, continuousAssessmentWeight, finalReportGradeMode, notEvaluatedValue, JSON.stringify(grades), JSON.stringify(gradesExplanation ?? {}), hasAssessmentWeights ? 1 : 0, hasLetterGrades ? 1 : 0);
    return this.getCenterConfiguration();
  }

  listTutorObservations() {
    const observations: Record<string, string> = {};
    for (const row of this.db.prepare('SELECT report_id, student_id, observation FROM tutor_observations').all() as Row[]) {
      observations[`${row.report_id}:${row.student_id}`] = row.observation;
    }
    return observations;
  }

  listReportSubjectExclusions(): ReportSubjectExclusion[] {
    return (this.db.prepare('SELECT report_id, subject FROM report_subject_exclusions ORDER BY report_id, subject').all() as Row[])
      .map(row => ({ reportId: Number(row.report_id), subject: String(row.subject) }));
  }

  private latestMutableReport(reportId: number) {
    const report = this.db.prepare('SELECT id, course_level, trimester FROM tracking_reports WHERE id = ?').get(reportId) as Row | undefined;
    if (!report) throw new Error('No se ha encontrado el informe.');
    const latest = this.latestReport(report.course_level, report.trimester);
    if (!latest || Number(latest.id) !== reportId) throw new Error('READ_ONLY_REPORT');
    // The current report remains editable after export. Its next export replaces
    // the previous snapshot; only earlier report versions are immutable.
    this.db.prepare('DELETE FROM report_snapshots WHERE report_id = ?').run(reportId);
    return report;
  }

  saveTutorObservation(reportId: number, studentId: number, observation: string) {
    const report = this.latestMutableReport(reportId);
    const student = this.db.prepare('SELECT course_level FROM students WHERE id = ?').get(studentId) as Row | undefined;
    if (!student || student.course_level !== report.course_level) throw new Error('El alumno no pertenece al curso seleccionado.');
    if (!observation.trim()) {
      this.db.prepare('DELETE FROM tutor_observations WHERE report_id = ? AND student_id = ?').run(reportId, studentId);
      return;
    }
    const now = this.now();
    this.db.prepare(`INSERT INTO tutor_observations(report_id, student_id, observation, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(report_id, student_id) DO UPDATE SET
      observation=excluded.observation, updated_at=excluded.updated_at`).run(reportId, studentId, observation, now);
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(now, reportId);
  }

  clearCenterData() {
    this.transaction(() => {
      this.db.exec('DELETE FROM tutor_observations');
      this.db.exec('DELETE FROM imported_worksheets');
      this.db.exec('DELETE FROM tracking_reports');
      this.db.exec('DELETE FROM worksheets');
      this.db.exec('DELETE FROM students');
      this.db.exec('DELETE FROM configured_courses');
      this.saveCenterConfiguration(DEFAULT_CENTER_CONFIGURATION);
    });
  }

  listCourses(): ConfiguredCourse[] {
    return (this.db.prepare('SELECT id, name, sort_order FROM configured_courses ORDER BY sort_order, name').all() as Row[])
      .map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order }));
  }

  listSubjects(courseId?: CourseLevel): ConfiguredSubject[] {
    const sql = `SELECT course_id, name, sort_order FROM configured_subjects${courseId ? ' WHERE course_id = ?' : ''} ORDER BY course_id, sort_order, name`;
    const rows = (courseId ? this.db.prepare(sql).all(courseId) : this.db.prepare(sql).all()) as Row[];
    return rows.map(row => ({ courseId: row.course_id, name: row.name, sortOrder: row.sort_order }));
  }

  hasCourse(courseId: CourseLevel) { return Boolean(this.db.prepare('SELECT 1 FROM configured_courses WHERE id = ?').get(courseId)); }
  hasSubject(courseId: CourseLevel, subject: string) { return Boolean(this.db.prepare('SELECT 1 FROM configured_subjects WHERE course_id = ? AND name = ?').get(courseId, subject)); }
  courseName(courseId: CourseLevel) { return (this.db.prepare('SELECT name FROM configured_courses WHERE id = ?').get(courseId) as Row | undefined)?.name ?? courseId; }

  replaceCourses(names: string[]): ConfiguredCourse[] {
    const cleaned = [...new Map(names.map(name => name.trim()).filter(Boolean).map(name => [name.toLocaleLowerCase(), name])).values()];
    if (!cleaned.length) throw new Error('El archivo no contiene cursos.');
    const existing = this.listCourses();
    const byName = new Map(existing.map(course => [course.name.toLocaleLowerCase(), course]));
    const retained = cleaned.map((name, index) => {
      const defaultId = COURSE_LEVELS.find(courseId => COURSE_LABELS[courseId].toLocaleLowerCase() === name.toLocaleLowerCase());
      return { id: byName.get(name.toLocaleLowerCase())?.id ?? defaultId ?? `course_${randomUUID()}`, name, sortOrder: index };
    });
    const upsert = this.db.prepare(`INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`);
    this.transaction(() => retained.forEach(course => upsert.run(course.id, course.name, course.sortOrder)));
    return this.listCourses();
  }

  replaceSubjectCatalog(entries: Array<{ course: string; subject: string }>): ConfiguredSubject[] {
    const courses = this.listCourses();
    const courseLookup = new Map(courses.flatMap(course => [[course.id.toLocaleLowerCase(), course.id], [course.name.toLocaleLowerCase(), course.id]]));
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      const courseId = courseLookup.get(entry.course.trim().toLocaleLowerCase());
      if (!courseId) throw new Error(`El curso “${entry.course}” no está configurado.`);
      const subject = entry.subject.trim(); if (!subject) continue;
      const list = grouped.get(courseId) ?? [];
      if (!list.some(item => item.toLocaleLowerCase() === subject.toLocaleLowerCase())) list.push(subject);
      grouped.set(courseId, list);
    }
    if (!grouped.size) throw new Error('El archivo no contiene asignaturas.');
    const insert = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
    this.transaction(() => grouped.forEach((subjects, courseId) => {
      const existing = this.listSubjects(courseId);
      const names = new Set(existing.map(subject => subject.name.toLocaleLowerCase()));
      let nextOrder = Math.max(-1, ...existing.map(subject => subject.sortOrder)) + 1;
      subjects.forEach(subject => { if (!names.has(subject.toLocaleLowerCase())) { insert.run(courseId, subject, nextOrder++); names.add(subject.toLocaleLowerCase()); } });
    }));
    return this.listSubjects();
  }

  private centerUpdateRevision() {
    return JSON.stringify({ roster: this.rosterRevision(), subjects: this.listSubjects(), configuration: configurationFingerprint(this.getCenterConfiguration()), reports: this.listTrackingReports() });
  }

  analyzeCenterUpdate(input: Array<{ name: string; subjects: string[]; students: string[] }>, configuration: CenterConfiguration): CenterUpdatePreview {
    if (!input.length) throw new Error('El archivo no contiene cursos.');
    const existing = this.listCourses();
    const seenCourses = new Set<string>();
    const courses = input.map(entry => {
      const name = entry.name.trim();
      const key = name.toLocaleLowerCase();
      if (!name || seenCourses.has(key)) throw new Error(`Curso vacío o duplicado: ${name}.`);
      seenCourses.add(key);
      const current = existing.find(course => course.name.toLocaleLowerCase() === key);
      const defaultId = COURSE_LEVELS.find(courseId => COURSE_LABELS[courseId].toLocaleLowerCase() === key);
      const courseId = current?.id ?? defaultId ?? `course_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
      if (!current && existing.some(course => course.id === courseId)) throw new Error(`El curso “${name}” entra en conflicto con otro curso configurado.`);
      const names = uniqueRosterNames(entry.students, name);
      const incomingSubjects = entry.subjects.map(subject => subject.trim()).filter(Boolean);
      if (!incomingSubjects.length || !names.length) throw new Error(`El curso “${name}” debe incluir asignaturas y alumnos.`);
      const currentSubjects = this.listSubjects(courseId).map(subject => subject.name);
      const subjectKeys = new Set(incomingSubjects.map(subject => subject.toLocaleLowerCase()));
      const addedSubjects = [...new Map(incomingSubjects.filter(subject => !currentSubjects.some(previous => previous.toLocaleLowerCase() === subject.toLocaleLowerCase())).map(subject => [subject.toLocaleLowerCase(), subject])).values()];
      const retainedSubjects = currentSubjects.filter(subject => subjectKeys.has(subject.toLocaleLowerCase()));
      const omittedSubjects = currentSubjects.filter(subject => !subjectKeys.has(subject.toLocaleLowerCase()));
      const all = this.listStudents(courseId);
      const active = this.listActiveStudents(courseId);
      const activeIds = new Set(active.map(student => student.id));
      const unchanged: RosterStudentReference[] = [];
      const added: string[] = [];
      const ambiguousMatches: CourseRosterAnalysis['ambiguousMatches'] = [];
      for (const studentName of names) {
        const candidates = all.filter(student => student.fullName === studentName);
        if (candidates.length === 1 && activeIds.has(candidates[0].id)) unchanged.push({ id: candidates[0].id, name: studentName });
        else {
          added.push(studentName);
          if (candidates.length) ambiguousMatches.push({ name: studentName, candidates: candidates.map(student => ({ id: student.id, name: student.fullName })) });
        }
      }
      const kept = new Set(unchanged.map(student => student.id));
      const removed = active.filter(student => !kept.has(student.id)).map(student => ({ id: student.id, name: student.fullName }));
      return { courseId, courseName: name, status: added.length || removed.length ? 'changed' as const : 'unchanged' as const,
        unchanged, added, removed, possibleNameChanges: added.length && removed.length ? { existing: removed, incoming: added } : null,
        ambiguousMatches, isNew: !current, addedSubjects, retainedSubjects, omittedSubjects,
        historicalStudents: all.filter(student => !activeIds.has(student.id)).map(student => ({ id: student.id, name: student.fullName })) };
    });
    const configurationChanged = configurationFingerprint(configuration) !== configurationFingerprint(this.getCenterConfiguration());
    const configurationBlocked = configurationChanged && Boolean(this.db.prepare('SELECT 1 FROM tracking_reports r LEFT JOIN report_snapshots s ON s.report_id = r.id WHERE s.report_id IS NULL LIMIT 1').get());
    return { revision: this.centerUpdateRevision(), courses, omittedCourses: existing.filter(course => !seenCourses.has(course.name.toLocaleLowerCase())).map(course => course.name),
      rosterChanged: courses.some(course => course.status === 'changed'), configurationChanged, configurationBlocked };
  }

  applyCenterUpdate(input: Array<{ name: string; subjects: string[]; students: string[] }>, configuration: CenterConfiguration, effectiveDate: string | null, assignments: RosterAssignment[], expectedRevision: string) {
    this.transaction(() => {
      const preview = this.analyzeCenterUpdate(input, configuration);
      if (preview.revision !== expectedRevision) throw new Error('Los datos del centro han cambiado desde la vista previa; vuelve a analizarlos.');
      if (preview.configurationBlocked) throw new Error('La nueva configuración de notas alteraría informes sin instantánea.');
      if (preview.rosterChanged && !effectiveDate) throw new Error('Indica la fecha efectiva de las altas y bajas.');
      if (!preview.rosterChanged && assignments.length) throw new Error('Hay asignaciones de alumnado que no corresponden a cambios del listado.');
      const upsertCourse = this.db.prepare(`INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`);
      const addSubject = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
      preview.courses.forEach((course, index) => upsertCourse.run(course.courseId, course.courseName, index));
      preview.courses.forEach(course => {
        let nextOrder = Math.max(-1, ...this.listSubjects(course.courseId).map(subject => subject.sortOrder)) + 1;
        course.addedSubjects.forEach(subject => addSubject.run(course.courseId, subject, nextOrder++));
      });
      const rosterInput = input.map(entry => ({ name: entry.name, students: entry.students }));
      if (preview.rosterChanged) this.applyCenterRoster(rosterInput, effectiveDate!, assignments, this.analyzeCenterRoster(rosterInput).revision);
      else preview.courses.forEach(course => {
        const names = input.find(entry => entry.name.trim() === course.courseName)!.students;
        names.forEach((name, index) => this.db.prepare('UPDATE students SET sort_order = ? WHERE course_level = ? AND full_name = ? AND id IN (SELECT student_id FROM student_enrollments WHERE ended_on IS NULL)').run(index, course.courseId, name));
      });
      this.saveCenterConfiguration(configuration);
    });
    return { courses: this.listCourses(), subjects: this.listSubjects(), students: this.listStudents(), centerConfiguration: this.getCenterConfiguration() };
  }

  replaceCenterData(input: Array<{ name: string; subjects: string[]; students: string[] }>, centerConfiguration: CenterConfiguration = DEFAULT_CENTER_CONFIGURATION) {
    const cleaned = input.map(course => ({ name: course.name.trim(), subjects: [...new Set(course.subjects.map(value => value.trim()).filter(Boolean))], students: uniqueRosterNames(course.students, course.name) })).filter(course => course.name);
    if (!cleaned.length) throw new Error('El archivo no contiene cursos.');
    const existingCourses = this.listCourses(); const byName = new Map(existingCourses.map(course => [course.name.toLocaleLowerCase(), course]));
    const resolved = cleaned.map((course, sortOrder) => {
      const defaultId = COURSE_LEVELS.find(courseId => COURSE_LABELS[courseId].toLocaleLowerCase() === course.name.toLocaleLowerCase());
      return { ...course, id: byName.get(course.name.toLocaleLowerCase())?.id ?? defaultId ?? `course_${randomUUID()}`, sortOrder };
    });
    const existingStudents = new Map(resolved.map(course => [course.id, this.listActiveStudents(course.id)]));
    const rosterChanges: CenterRosterChange[] = [];
    for (const course of resolved) {
      if (!course.subjects.length || !course.students.length) throw new Error(`El curso “${course.name}” debe incluir asignaturas y alumnos.`);
      const previous = existingStudents.get(course.id) ?? [];
      if (this.listStudents(course.id).length) {
        const difference = rosterDifference(previous.map(student => student.fullName), course.students);
        if (difference.added.length || difference.removed.length) rosterChanges.push({ course: course.name, ...difference });
      }
    }
    if (rosterChanges.length) throw new CenterRosterChangeError(rosterChanges);
    const upsertCourse = this.db.prepare(`INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`);
    const addSubject = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
    const updateStudentOrder = this.db.prepare('UPDATE students SET sort_order = ? WHERE id = ?'); const addStudent = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)');
    this.transaction(() => {
      resolved.forEach(course => upsertCourse.run(course.id, course.name, course.sortOrder));
      resolved.forEach(course => {
        const existingSubjects = this.listSubjects(course.id);
        const subjectNames = new Set(existingSubjects.map(subject => subject.name.toLocaleLowerCase()));
        let nextSubjectOrder = Math.max(-1, ...existingSubjects.map(subject => subject.sortOrder)) + 1;
        course.subjects.forEach(subject => { if (!subjectNames.has(subject.toLocaleLowerCase())) { addSubject.run(course.id, subject, nextSubjectOrder++); subjectNames.add(subject.toLocaleLowerCase()); } });
        const available = (existingStudents.get(course.id) ?? []).reduce<Map<string, Student[]>>((map, student) => { const matches = map.get(student.fullName) ?? []; matches.push(student); map.set(student.fullName, matches); return map; }, new Map());
        course.students.forEach((name, index) => { const match = available.get(name)?.shift(); if (match) updateStudentOrder.run(index, match.id); else addStudent.run(course.id, name, index, this.now()); });
      });
      this.saveCenterConfiguration(centerConfiguration);
    });
    return { courses: this.listCourses(), subjects: this.listSubjects(), students: this.listStudents(), centerConfiguration: this.getCenterConfiguration() };
  }

  listStudents(courseLevel?: CourseLevel): Student[] {
    const sql = `SELECT id, course_level, full_name, sort_order FROM students${courseLevel ? ' WHERE course_level = ?' : ''} ORDER BY course_level, sort_order, id`;
    const rows = (courseLevel ? this.db.prepare(sql).all(courseLevel) : this.db.prepare(sql).all()) as Row[];
    return rows.map(row => ({ id: row.id, courseLevel: row.course_level, fullName: row.full_name, sortOrder: row.sort_order }));
  }

  listStudentEnrollments(studentId?: number): StudentEnrollment[] {
    const sql = `SELECT id, student_id, started_on, ended_on FROM student_enrollments${studentId === undefined ? '' : ' WHERE student_id = ?'} ORDER BY student_id, id`;
    const rows = (studentId === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(studentId)) as Row[];
    return rows.map(row => ({ id: row.id, studentId: row.student_id, startedOn: row.started_on, endedOn: row.ended_on }));
  }

  listActiveStudents(courseLevel?: CourseLevel): Student[] {
    const sql = `SELECT s.id, s.course_level, s.full_name, s.sort_order FROM students s
      JOIN student_enrollments e ON e.student_id = s.id AND e.ended_on IS NULL
      ${courseLevel ? 'WHERE s.course_level = ?' : ''} ORDER BY s.course_level, s.sort_order, s.id`;
    const rows = (courseLevel ? this.db.prepare(sql).all(courseLevel) : this.db.prepare(sql).all()) as Row[];
    return rows.map(row => ({ id: row.id, courseLevel: row.course_level, fullName: row.full_name, sortOrder: row.sort_order }));
  }

  private rosterRevision(): string {
    return JSON.stringify({ courses: this.listCourses(), students: this.listStudents(), enrollments: this.listStudentEnrollments() });
  }

  private resolveRosterInput(input: Array<{ name: string; students: string[] }>) {
    if (!input.length) throw new Error('El archivo no contiene cursos.');
    const courses = this.listCourses();
    const seen = new Set<string>();
    return input.map(entry => {
      const name = entry.name.trim();
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) throw new Error(`Curso duplicado en el archivo: ${name}.`);
      seen.add(key);
      const course = courses.find(item => item.name.toLocaleLowerCase() === key);
      if (!course) throw new Error(`El curso “${name}” no está configurado en el centro.`);
      if (!Array.isArray(entry.students)) throw new Error(`Falta el listado de alumnos de “${name}”.`);
      return { course, names: uniqueRosterNames(entry.students, name) };
    });
  }

  // Internal-only phase 2 API. It is deliberately not registered in IPC.
  analyzeCenterRoster(input: Array<{ name: string; students: string[] }>): CenterRosterAnalysis {
    const resolved = this.resolveRosterInput(input);
    const courses = resolved.map(({ course, names }): CourseRosterAnalysis => {
      const all = this.listStudents(course.id);
      const active = this.listActiveStudents(course.id);
      const activeIds = new Set(active.map(student => student.id));
      const unchanged: RosterStudentReference[] = [];
      const added: string[] = [];
      const ambiguousMatches: CourseRosterAnalysis['ambiguousMatches'] = [];
      for (const name of names) {
        const candidates = all.filter(student => student.fullName === name);
        if (candidates.length === 1 && activeIds.has(candidates[0].id)) unchanged.push({ id: candidates[0].id, name });
        else {
          added.push(name);
          if (candidates.length) ambiguousMatches.push({ name, candidates: candidates.map(student => ({ id: student.id, name: student.fullName })) });
        }
      }
      const kept = new Set(unchanged.map(student => student.id));
      const removed = active.filter(student => !kept.has(student.id)).map(student => ({ id: student.id, name: student.fullName }));
      return {
        courseId: course.id, courseName: course.name,
        status: added.length || removed.length ? 'changed' : 'unchanged', unchanged, added, removed,
        possibleNameChanges: added.length && removed.length ? { existing: removed, incoming: added } : null,
        ambiguousMatches
      };
    });
    return { revision: this.rosterRevision(), courses };
  }

  // Internal-only until worksheet and report semantics are updated in a later phase.
  applyCenterRoster(input: Array<{ name: string; students: string[] }>, effectiveDate: string, assignments: RosterAssignment[], expectedRevision: string): void {
    strictDate(effectiveDate);
    this.transaction(() => {
      const analysis = this.analyzeCenterRoster(input);
      if (analysis.revision !== expectedRevision) throw new Error('El listado ha cambiado desde el análisis; vuelve a analizarlo.');
      const resolved = this.resolveRosterInput(input);
      const pending = new Map<string, RosterAssignment>();
      for (const assignment of assignments) {
        const key = `${assignment.courseId}\u0000${assignment.incomingName}`;
        if (pending.has(key)) throw new Error(`Asignación duplicada: ${assignment.incomingName}.`);
        if (assignment.studentId !== null && (!Number.isInteger(assignment.studentId) || assignment.studentId <= 0)) throw new Error('El ID de alumno asignado no es válido.');
        pending.set(key, assignment);
      }
      const plans = resolved.map(({ course, names }) => {
        const courseAnalysis = analysis.courses.find(item => item.courseId === course.id)!;
        const active = this.listActiveStudents(course.id);
        const all = this.listStudents(course.id);
        const exact = new Map(courseAnalysis.unchanged.map(student => [student.name, student.id]));
        const used = new Set<number>(exact.values());
        const incoming = names.map(name => {
          const exactId = exact.get(name);
          if (exactId !== undefined) return { name, studentId: exactId };
          const key = `${course.id}\u0000${name}`;
          const assignment = pending.get(key);
          if (!assignment) throw new Error(`Falta confirmar el alta o cambio de nombre de “${name}” en “${course.name}”.`);
          pending.delete(key);
          if (assignment.studentId !== null) {
            if (!all.some(student => student.id === assignment.studentId)) throw new Error(`El alumno asignado a “${name}” no pertenece a “${course.name}”.`);
            if (used.has(assignment.studentId)) throw new Error(`El alumno ${assignment.studentId} tiene dos asignaciones.`);
            used.add(assignment.studentId);
          }
          return { name, studentId: assignment.studentId };
        });
        for (const student of active) {
          if (used.has(student.id)) continue;
          const current = this.listStudentEnrollments(student.id).at(-1)!;
          if (current.startedOn !== null && effectiveDate <= current.startedOn) throw new Error(`La baja de “${student.fullName}” debe ser posterior a su alta.`);
        }
        for (const item of incoming) {
          if (item.studentId === null || active.some(student => student.id === item.studentId)) continue;
          const last = this.listStudentEnrollments(item.studentId).at(-1)!;
          if (last.endedOn === null || effectiveDate <= last.endedOn) throw new Error(`El regreso de “${item.name}” debe ser posterior a su baja.`);
        }
        return { course, active, used, incoming };
      });
      if (pending.size) throw new Error('Hay asignaciones que no corresponden al listado analizado.');
      const close = this.db.prepare('UPDATE student_enrollments SET ended_on = ? WHERE student_id = ? AND ended_on IS NULL');
      const update = this.db.prepare('UPDATE students SET full_name = ?, sort_order = ? WHERE id = ?');
      const insert = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)');
      const reopen = this.db.prepare('INSERT INTO student_enrollments(student_id, started_on, ended_on) VALUES (?, ?, NULL)');
      const setInitialStart = this.db.prepare('UPDATE student_enrollments SET started_on = ? WHERE student_id = ? AND ended_on IS NULL');
      for (const plan of plans) {
        for (const student of plan.active) if (!plan.used.has(student.id)) close.run(effectiveDate, student.id);
        plan.incoming.forEach(({ name, studentId }, index) => {
          if (studentId === null) {
            const result = insert.run(plan.course.id, name, index, this.now());
            setInitialStart.run(effectiveDate, Number(result.lastInsertRowid));
          } else {
            if (!plan.active.some(student => student.id === studentId)) reopen.run(studentId, effectiveDate);
            update.run(name, index, studentId);
          }
        });
      }
    });
  }

  addStudent(courseLevel: CourseLevel, fullName: string): Student {
    const name = fullName.trim();
    if (!name) throw new Error('El nombre del alumno no puede estar vacío.');
    if (this.listActiveStudents(courseLevel).some(student => student.fullName.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`Nombre de alumno duplicado en “${this.courseName(courseLevel)}”: ${name}.`);
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM students WHERE course_level = ?').get(courseLevel) as Row).n;
    const result = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)')
      .run(courseLevel, name, next, this.now());
    return this.listStudents(courseLevel).find(s => s.id === Number(result.lastInsertRowid))!;
  }

  updateStudent(id: number, fullName: string): Student {
    const name = fullName.trim();
    if (!name) throw new Error('El nombre del alumno no puede estar vacío.');
    const before = this.listStudents().find(student => student.id === id);
    if (before && this.listActiveStudents(before.courseLevel).some(student => student.id !== id && student.fullName.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`Nombre de alumno duplicado en “${this.courseName(before.courseLevel)}”: ${name}.`);
    this.db.prepare('UPDATE students SET full_name = ? WHERE id = ?').run(name, id);
    const row = this.db.prepare('SELECT id, course_level, full_name, sort_order FROM students WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado el alumno.');
    return { id: row.id, courseLevel: row.course_level, fullName: row.full_name, sortOrder: row.sort_order };
  }

  deleteStudent(id: number) {
    const student = this.db.prepare('SELECT course_level FROM students WHERE id = ?').get(id) as Row | undefined;
    if (!student) return;
    const directReference = this.db.prepare(`SELECT 1 FROM worksheet_values WHERE student_id = ?
      UNION SELECT 1 FROM worksheet_disabled_students WHERE student_id = ?
      UNION SELECT 1 FROM tutor_observations WHERE student_id = ? LIMIT 1`).get(id, id, id);
    const courseReference = this.db.prepare(`SELECT 1 FROM worksheets WHERE course_level = ?
      UNION SELECT 1 FROM tracking_reports WHERE course_level = ?
      UNION SELECT 1 FROM imported_worksheets WHERE course_level = ? LIMIT 1`).get(student.course_level, student.course_level, student.course_level);
    const enrollments = this.listStudentEnrollments(id);
    if (directReference || courseReference || enrollments.some(item => item.endedOn !== null)) throw new Error('No se puede borrar un alumno con hojas, notas, observaciones, informes o bajas históricas asociados.');
    this.db.prepare('DELETE FROM students WHERE id = ?').run(id);
  }

  reorderStudents(courseLevel: CourseLevel, ids: number[]): Student[] {
    const existing = this.listStudents(courseLevel).map(s => s.id);
    if (existing.length !== ids.length || [...existing].sort().some((id, index) => id !== [...ids].sort()[index])) {
      throw new Error('La lista de alumnos no coincide con el curso.');
    }
    const update = this.db.prepare('UPDATE students SET sort_order = ? WHERE id = ? AND course_level = ?');
    this.transaction(() => ids.forEach((id, index) => update.run(index, id, courseLevel)));
    return this.listStudents(courseLevel);
  }

  replaceCourseRoster(courseLevel: CourseLevel, names: string[]): Student[] {
    const cleaned = uniqueRosterNames(names, this.courseName(courseLevel));
    if (cleaned.length === 0) throw new Error('La lista debe contener al menos un alumno.');
    const existing = this.listActiveStudents(courseLevel);
    if (this.listStudents(courseLevel).length) {
      const difference = rosterDifference(existing.map(student => student.fullName), cleaned);
      if (difference.added.length || difference.removed.length) throw new CenterRosterChangeError([{ course: this.courseName(courseLevel), ...difference }]);
    }
    const available = existing.reduce<Map<string, Student[]>>((map, student) => {
      const entries = map.get(student.fullName) ?? [];
      entries.push(student); map.set(student.fullName, entries); return map;
    }, new Map());
    const update = this.db.prepare('UPDATE students SET sort_order = ? WHERE id = ?');
    const insert = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)');
    this.transaction(() => {
      cleaned.forEach((name, index) => {
        const match = available.get(name)?.shift();
        if (match) update.run(index, match.id);
        else insert.run(courseLevel, name, index, this.now());
      });
    });
    return this.listStudents(courseLevel);
  }

  listWorksheets(): WorksheetSummary[] {
    const summaries = (this.db.prepare(`SELECT w.*,
      (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id AND c.kind = 'EXAM') AS exam_count,
      (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id AND c.kind = 'CONTINUOUS_ASSESSMENT') AS continuous_count,
      0 AS is_complete
      FROM worksheets w ORDER BY w.course_level, w.trimester, w.subject`).all() as Row[]).map(this.mapWorksheet);
    return summaries.map(summary => ({ ...summary, isComplete: this.isWorksheetComplete(summary), changeSummary: summary.copiedFromId ? this.getWorksheetChanges(summary.id, summary.copiedFromId) : undefined }));
  }

  private isWorksheetComplete(worksheet: WorksheetSummary) {
    const columns = (this.db.prepare('SELECT id, assessment_date FROM worksheet_columns WHERE worksheet_id = ?').all(worksheet.id) as Row[]).map(row => ({ id: Number(row.id), assessmentDate: row.assessment_date as string }));
    const students = (this.db.prepare(`SELECT id FROM students s WHERE s.course_level = ? AND (? = 0 OR NOT EXISTS (SELECT 1 FROM worksheet_disabled_students d WHERE d.worksheet_id = ? AND d.student_id = s.id))`).all(worksheet.courseLevel, worksheet.isElective ? 1 : 0, worksheet.id) as Row[]).map(row => Number(row.id));
    if (!columns.length || !students.length) return false;
    const values = new Map((this.db.prepare('SELECT student_id, column_id, value FROM worksheet_values WHERE worksheet_id = ?').all(worksheet.id) as Row[]).map(row => [`${row.student_id}:${row.column_id}`, row.value as string]));
    const overrides = this.worksheetApplicabilityOverrides(worksheet.id);
    const configuration = this.getCenterConfiguration();
    let applicableCount = 0;
    for (const studentId of students) {
      const periods = this.listStudentEnrollments(studentId);
      for (const column of columns) {
        const key = `${studentId}:${column.id}`;
        const status = overrides.get(key) ?? assessmentApplicability(column.assessmentDate, periods);
        if (status === 'UNRESOLVED') return false;
        if (status === 'NOT_APPLICABLE') continue;
        applicableCount++;
        if (!isCompleteGradeValue(values.get(key) ?? '', worksheet.gradeMode, configuration.grades, configuration.notEvaluatedValue)) return false;
      }
    }
    return applicableCount > 0;
  }

  private mapWorksheet = (row: Row): WorksheetSummary => ({
    id: row.id, courseLevel: row.course_level, trimester: row.trimester, subject: row.subject, gradeMode: row.grade_mode === 'LETTER' ? 'LETTER' : 'NUMERIC', isElective: Boolean(row.is_elective),
    createdAt: row.created_at, updatedAt: row.updated_at, isComplete: Boolean(row.is_complete), examCount: Number(row.exam_count ?? 0), continuousAssessmentCount: Number(row.continuous_count ?? 0), copiedFromId: row.copied_from_id === null || row.copied_from_id === undefined ? undefined : Number(row.copied_from_id)
  });

  private worksheetApplicabilityOverrides(worksheetId: number): Map<string, 'APPLICABLE' | 'NOT_APPLICABLE'> {
    const overrides = new Map<string, 'APPLICABLE' | 'NOT_APPLICABLE'>((this.db.prepare('SELECT student_id, column_id, status FROM worksheet_applicability_overrides WHERE worksheet_id = ?').all(worksheetId) as Row[])
      .map(row => [`${row.student_id}:${row.column_id}`, row.status]));
    const students = this.db.prepare('SELECT id FROM students').all() as Row[];
    for (const column of this.db.prepare('SELECT id, student_ids_json FROM worksheet_columns WHERE worksheet_id = ? AND student_ids_json IS NOT NULL').all(worksheetId) as Row[]) {
      const selected = new Set<number>(JSON.parse(column.student_ids_json));
      for (const student of students) if (!selected.has(Number(student.id))) overrides.set(`${student.id}:${column.id}`, 'NOT_APPLICABLE');
    }
    return overrides;
  }

  private validateAssessmentStudents(worksheetId: number, studentIds?: number[] | null) {
    if (studentIds == null) return;
    const worksheet = this.db.prepare('SELECT course_level FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!worksheet || !Array.isArray(studentIds) || !studentIds.length) throw new Error('INDIVIDUAL_STUDENTS_REQUIRED');
    const allowed = new Set(this.listStudents(worksheet.course_level).map(student => student.id));
    if (studentIds.some(id => !Number.isInteger(id) || !allowed.has(id)) || new Set(studentIds).size !== studentIds.length) throw new Error('INVALID_ASSESSMENT_STUDENTS');
  }

  private getWorksheetChanges(worksheetId: number, sourceWorksheetId: number): WorksheetChangeSummary {
    const readSnapshot = (id: number) => {
      const row = this.db.prepare('SELECT roster_snapshot_json FROM worksheets WHERE id = ?').get(id) as Row | undefined;
      try { return new Set<string>(JSON.parse(row?.roster_snapshot_json ?? '[]')); } catch { return new Set<string>(); }
    };
    const sourceExists = this.db.prepare('SELECT 1 FROM worksheets WHERE id = ?').get(sourceWorksheetId);
    const fallbackSource = sourceExists ? undefined : this.db.prepare(`SELECT source.id FROM worksheets copy
      JOIN worksheets source ON source.course_level = copy.course_level AND source.subject = copy.subject AND source.trimester < copy.trimester
      WHERE copy.id = ? ORDER BY source.trimester DESC, source.id DESC LIMIT 1`).get(worksheetId) as Row | undefined;
    const resolvedSourceId = sourceExists ? sourceWorksheetId : fallbackSource ? Number(fallbackSource.id) : worksheetId;
    const sourceStudents = readSnapshot(resolvedSourceId); const currentStudents = readSnapshot(worksheetId);
    const addedStudents = [...currentStudents].filter(name => !sourceStudents.has(name));
    const removedStudents = [...sourceStudents].filter(name => !currentStudents.has(name));
    const addedAssessments = (this.db.prepare('SELECT name FROM worksheet_columns WHERE worksheet_id = ? AND source_column_id IS NULL ORDER BY sort_order, id').all(worksheetId) as Row[]).map(row => row.name as string);
    return { addedStudents, removedStudents, addedAssessments };
  }

  private rosterSnapshot(courseLevel: CourseLevel) {
    return JSON.stringify(this.listActiveStudents(courseLevel).map(student => student.fullName));
  }

  createWorksheet(input: { courseLevel: CourseLevel; trimester: Trimester; subject: string; gradeMode?: GradeMode; isElective?: boolean }): WorksheetSummary {
    const now = this.now();
    const gradeMode = input.gradeMode ?? 'NUMERIC';
    if (!['NUMERIC', 'LETTER'].includes(gradeMode)) throw new Error('Tipo de nota no válido.');
    if (gradeMode === 'LETTER' && !this.getCenterConfiguration().hasLetterGrades) throw new Error('Las notas con letras no están configuradas para el centro.');
    try {
      const result = this.db.prepare('INSERT INTO worksheets(course_level, trimester, subject, grade_mode, is_elective, created_at, updated_at, roster_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.courseLevel, input.trimester, input.subject, gradeMode, input.isElective ? 1 : 0, now, now, this.rosterSnapshot(input.courseLevel));
      return this.listWorksheets().find(sheet => sheet.id === Number(result.lastInsertRowid))!;
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('DUPLICATE_WORKSHEET', { cause: error });
      throw error;
    }
  }

  restoreWorksheet(data: FullSeguimentExport, replace: boolean): WorksheetSummary {
    const targetTrimester = normalizeTrimester(data.trimester.id);
    if (!targetTrimester) throw new Error('INVALID_TRIMESTER');
    const gradeMode = data.subject.gradeMode ?? 'NUMERIC';
    const isElective = Boolean(data.subject.isElective);
    const configuration = this.getCenterConfiguration();
    if (gradeMode === 'LETTER' && !configuration.hasLetterGrades) throw new Error('LETTER_GRADES_NOT_CONFIGURED');
    const normalized = normalizeImportedNumericGrades(data);
    for (const student of normalized.students) for (const value of Object.values(student.values)) {
      if (value && !isCompleteGradeValue(value, gradeMode, configuration.grades, configuration.notEvaluatedValue)) throw new Error('INVALID_GRADE_VALUE');
    }
    const existing = this.listWorksheets().find(worksheet => worksheet.courseLevel === normalized.course.level && worksheet.trimester === targetTrimester && worksheet.subject === normalized.subject.name);
    if (existing && !replace) throw new Error('DUPLICATE_WORKSHEET');
    const students = this.listStudents(normalized.course.level);
    if (normalized.version === 2 && new Set(students.map(student => student.fullName.toLocaleLowerCase())).size !== students.length) throw new Error('AMBIGUOUS_STUDENT_NAMES');
    const studentIds = new Map<string, number[]>();
    for (const student of students) studentIds.set(student.fullName, [...(studentIds.get(student.fullName) ?? []), student.id]);
    const importedStudentIds = normalized.students.map(student => {
      const id = studentIds.get(student.name)?.shift();
      if (!id) throw new Error('STUDENT_ROSTER_MISMATCH');
      return { student, id };
    });
    if (importedStudentIds.length !== students.length || [...studentIds.values()].some(ids => ids.length)) throw new Error('STUDENT_ROSTER_MISMATCH');
    const now = this.now();
    let worksheetId = 0;
    this.transaction(() => {
      if (existing) {
        worksheetId = existing.id;
        this.db.prepare('DELETE FROM worksheet_disabled_students WHERE worksheet_id = ?').run(worksheetId);
        this.db.prepare('DELETE FROM worksheet_columns WHERE worksheet_id = ?').run(worksheetId);
        this.db.prepare('DELETE FROM worksheet_applicability_overrides WHERE worksheet_id = ?').run(worksheetId);
        this.db.prepare('UPDATE worksheets SET grade_mode = ?, is_elective = ?, updated_at = ?, copied_from_id = NULL, roster_snapshot_json = ? WHERE id = ?')
          .run(gradeMode, isElective ? 1 : 0, now, this.rosterSnapshot(normalized.course.level), worksheetId);
      } else {
        const result = this.db.prepare('INSERT INTO worksheets(course_level, trimester, subject, grade_mode, is_elective, created_at, updated_at, roster_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(normalized.course.level, targetTrimester, normalized.subject.name, gradeMode, isElective ? 1 : 0, now, now, this.rosterSnapshot(normalized.course.level));
        worksheetId = Number(result.lastInsertRowid);
      }
      const insertColumn = this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order, student_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const columnIds = new Map<string, number>();
      normalized.columns.forEach((column, index) => {
        const individualIds = column.isIndividual ? importedStudentIds.filter(({ student }) => student.applicability?.[column.id] === 'APPLICABLE').map(({ id }) => id) : null;
        const inserted = insertColumn.run(worksheetId, column.id, column.name.trim(), column.kind ?? 'CONTINUOUS_ASSESSMENT', column.assessmentDate ?? '', index, individualIds === null ? null : JSON.stringify(individualIds));
        columnIds.set(column.id, Number(inserted.lastInsertRowid));
      });
      const disableStudent = this.db.prepare('INSERT INTO worksheet_disabled_students(worksheet_id, student_id) VALUES (?, ?)');
      const insertValue = this.db.prepare('INSERT INTO worksheet_values(worksheet_id, student_id, column_id, value, observation) VALUES (?, ?, ?, ?, ?)');
      const insertApplicability = this.db.prepare('INSERT INTO worksheet_applicability_overrides(worksheet_id, student_id, column_id, status) VALUES (?, ?, ?, ?)');
      for (const { student, id } of importedStudentIds) {
        if (isElective && student.enabled === false) disableStudent.run(worksheetId, id);
        for (const column of normalized.columns) {
          if (normalized.version === 2) {
            const status = student.applicability?.[column.id];
            if (status !== 'APPLICABLE' && status !== 'NOT_APPLICABLE') throw new Error('INVALID_APPLICABILITY');
            insertApplicability.run(worksheetId, id, columnIds.get(column.id)!, status);
          }
          const value = normalizeGradeValue(student.values[column.id] ?? '');
          const observation = student.observations?.[column.id] ?? '';
          if (value || observation) insertValue.run(worksheetId, id, columnIds.get(column.id)!, value, observation);
        }
      }
    });
    return this.listWorksheets().find(worksheet => worksheet.id === worksheetId)!;
  }

  copyWorksheet(worksheetId: number, trimester: Trimester): WorksheetSummary {
    const source = this.db.prepare('SELECT course_level, trimester, subject, grade_mode, is_elective FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!source) throw new Error('No se ha encontrado la hoja.');
    if (!normalizeTrimester(trimester)) throw new Error('El trimestre no es válido.');
    if (source.trimester === trimester) throw new Error('DUPLICATE_WORKSHEET');
    if (this.db.prepare('SELECT 1 FROM worksheets WHERE course_level = ? AND trimester = ? AND subject = ?').get(source.course_level, trimester, source.subject)) throw new Error('DUPLICATE_WORKSHEET');
    const now = this.now();
    let newId = 0;
    this.transaction(() => {
      const result = this.db.prepare('INSERT INTO worksheets(course_level, trimester, subject, grade_mode, is_elective, created_at, updated_at, copied_from_id, roster_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(source.course_level, trimester, source.subject, source.grade_mode, source.is_elective, now, now, worksheetId, this.rosterSnapshot(source.course_level));
      newId = Number(result.lastInsertRowid);
      const insertColumn = this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order, source_column_id, student_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const sourceColumns = this.db.prepare('SELECT id, name, kind, sort_order, student_ids_json FROM worksheet_columns WHERE worksheet_id = ? ORDER BY sort_order, id').all(worksheetId) as Row[];
      sourceColumns.forEach(column => insertColumn.run(newId, `col_${randomUUID()}`, column.name, column.kind, '', column.sort_order, column.id, column.student_ids_json));
      if (source.is_elective) {
        this.db.prepare('INSERT INTO worksheet_disabled_students(worksheet_id, student_id) SELECT ?, student_id FROM worksheet_disabled_students WHERE worksheet_id = ?').run(newId, worksheetId);
      }
    });
    return this.listWorksheets().find(sheet => sheet.id === newId)!;
  }

  deleteWorksheet(id: number) { this.db.prepare('DELETE FROM worksheets WHERE id = ?').run(id); }

  getWorksheet(id: number): WorksheetDetail {
    const worksheet = this.db.prepare('SELECT * FROM worksheets WHERE id = ?').get(id) as Row | undefined;
    if (!worksheet) throw new Error('No se ha encontrado la hoja.');
    const columns = (this.db.prepare('SELECT * FROM worksheet_columns WHERE worksheet_id = ? ORDER BY sort_order, id').all(id) as Row[])
      .map(row => ({ id: row.id, worksheetId: row.worksheet_id, exportId: row.export_id, name: row.name, kind: row.kind ?? 'CONTINUOUS_ASSESSMENT', assessmentDate: row.assessment_date ?? '', sortOrder: row.sort_order, studentIds: row.student_ids_json == null ? undefined : JSON.parse(row.student_ids_json) as number[], sourceColumnId: row.source_column_id === null || row.source_column_id === undefined ? undefined : Number(row.source_column_id) }));
    const values: Record<string, string> = {};
    const observations: Record<string, string> = {};
    for (const row of this.db.prepare('SELECT student_id, column_id, value, observation FROM worksheet_values WHERE worksheet_id = ?').all(id) as Row[]) {
      values[`${row.student_id}:${row.column_id}`] = row.value;
      observations[`${row.student_id}:${row.column_id}`] = row.observation;
    }
    const summary = this.listWorksheets().find(item => item.id === id)!;
    const disabledStudentIds = (this.db.prepare('SELECT student_id FROM worksheet_disabled_students WHERE worksheet_id = ? ORDER BY student_id').all(id) as Row[]).map(row => Number(row.student_id));
    const overrides = this.worksheetApplicabilityOverrides(id);
    const students = this.listStudents(worksheet.course_level);
    const activeStudentIds = this.listActiveStudents(worksheet.course_level).map(student => student.id);
    const disabled = new Set(disabledStudentIds);
    const applicability = Object.fromEntries(students.flatMap(student => columns.map(column => [
      `${student.id}:${column.id}`,
      worksheet.is_elective && disabled.has(student.id) ? 'NOT_APPLICABLE' : overrides.get(`${student.id}:${column.id}`) ?? assessmentApplicability(column.assessmentDate, this.listStudentEnrollments(student.id))
    ])));
    return { ...summary, students, activeStudentIds, columns, values, observations, applicability, disabledStudentIds };
  }

  configureElectiveStudents(worksheetId: number, enabledStudentIds: number[]): WorksheetDetail {
    const worksheet = this.db.prepare('SELECT course_level, is_elective FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!worksheet || !worksheet.is_elective) throw new Error('La asignatura no es optativa.');
    const students = this.listStudents(worksheet.course_level);
    const validIds = new Set(students.map(student => student.id));
    const enabled = new Set(enabledStudentIds);
    if (enabled.size === 0 || enabled.size !== enabledStudentIds.length || [...enabled].some(id => !Number.isInteger(id) || !validIds.has(id))) throw new Error('Selección de alumnado no válida.');
    const disable = this.db.prepare('INSERT INTO worksheet_disabled_students(worksheet_id, student_id) VALUES (?, ?)');
    const previouslyDisabled = new Set((this.db.prepare('SELECT student_id FROM worksheet_disabled_students WHERE worksheet_id = ?').all(worksheetId) as Row[]).map(row => Number(row.student_id)));
    this.transaction(() => {
      this.db.prepare('DELETE FROM worksheet_disabled_students WHERE worksheet_id = ?').run(worksheetId);
      students.filter(student => !enabled.has(student.id)).forEach(student => disable.run(worksheetId, student.id));
      const clearOverride = this.db.prepare('DELETE FROM worksheet_applicability_overrides WHERE worksheet_id = ? AND student_id = ?');
      enabledStudentIds.filter(id => previouslyDisabled.has(id)).forEach(id => clearOverride.run(worksheetId, id));
      this.touch(worksheetId);
    });
    return this.getWorksheet(worksheetId);
  }

  addAssessment(worksheetId: number, kind: AssessmentKind, name: string, assessmentDate: string, studentIds?: number[] | null): WorksheetDetail {
    this.validateAssessmentStudents(worksheetId, studentIds);
    const clean = name.trim();
    if (!clean) throw new Error('El nombre de la columna no puede estar vacío.');
    if (!['EXAM', 'CONTINUOUS_ASSESSMENT'].includes(kind)) throw new Error('Tipo de evaluación no válido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) throw new Error('La fecha de realización no es válida.');
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM worksheet_columns WHERE worksheet_id = ?').get(worksheetId) as Row).n;
    this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order, student_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(worksheetId, `col_${randomUUID()}`, clean, kind, assessmentDate, next, studentIds == null ? null : JSON.stringify(studentIds));
    this.touch(worksheetId);
    return this.getWorksheet(worksheetId);
  }

  updateAssessment(id: number, input: { kind: AssessmentKind; name: string; assessmentDate: string; studentIds?: number[] | null }) {
    const clean = input.name.trim();
    if (!clean || !['EXAM', 'CONTINUOUS_ASSESSMENT'].includes(input.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(input.assessmentDate)) throw new Error('Datos de evaluación no válidos.');
    const row = this.db.prepare('SELECT worksheet_id FROM worksheet_columns WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la evaluación.');
    this.validateAssessmentStudents(row.worksheet_id, input.studentIds);
    this.db.prepare('UPDATE worksheet_columns SET name = ?, kind = ?, assessment_date = ? WHERE id = ?').run(clean, input.kind, input.assessmentDate, id);
    if (input.studentIds !== undefined) this.db.prepare('UPDATE worksheet_columns SET student_ids_json = ? WHERE id = ?').run(input.studentIds === null ? null : JSON.stringify(input.studentIds), id);
    this.db.prepare('DELETE FROM worksheet_applicability_overrides WHERE column_id = ?').run(id);
    this.touch(row.worksheet_id);
  }

  renameColumn(id: number, name: string) {
    const clean = name.trim();
    if (!clean) throw new Error('El nombre de la columna no puede estar vacío.');
    const row = this.db.prepare('SELECT worksheet_id FROM worksheet_columns WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la columna.');
    this.db.prepare('UPDATE worksheet_columns SET name = ? WHERE id = ?').run(clean, id);
    this.touch(row.worksheet_id);
  }

  deleteColumn(id: number) {
    const row = this.db.prepare('SELECT worksheet_id, source_column_id FROM worksheet_columns WHERE id = ?').get(id) as Row | undefined;
    if (row?.source_column_id !== null && row?.source_column_id !== undefined) throw new Error('COPIED_ASSESSMENT_CANNOT_BE_DELETED');
    if (row) { this.db.prepare('DELETE FROM worksheet_columns WHERE id = ?').run(id); this.touch(row.worksheet_id); }
  }

  saveCell(worksheetId: number, studentId: number, columnId: number, field: 'grade' | 'observation', value: string) {
    if (!['grade', 'observation'].includes(field)) throw new Error('Campo de evaluación no válido.');
    const worksheet = this.db.prepare('SELECT grade_mode, course_level FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!worksheet) throw new Error('No se ha encontrado la hoja.');
    const student = this.db.prepare('SELECT course_level FROM students WHERE id = ?').get(studentId) as Row | undefined;
    const column = this.db.prepare('SELECT worksheet_id, assessment_date FROM worksheet_columns WHERE id = ?').get(columnId) as Row | undefined;
    if (!student || student.course_level !== worksheet.course_level || !column || column.worksheet_id !== worksheetId) throw new Error('La celda no pertenece a esta hoja.');
    const current = this.db.prepare('SELECT value, observation FROM worksheet_values WHERE worksheet_id = ? AND student_id = ? AND column_id = ?')
      .get(worksheetId, studentId, columnId) as Row | undefined;
    const configuration = this.getCenterConfiguration();
    const grade = field === 'grade' ? normalizeGradeValue(value) : current?.value ?? '';
    if (field === 'grade' && grade && !isCompleteGradeValue(grade, worksheet.grade_mode === 'LETTER' ? 'LETTER' : 'NUMERIC', configuration.grades, configuration.notEvaluatedValue)) throw new Error('INVALID_GRADE_VALUE');
    const applicability = this.worksheetApplicabilityOverrides(worksheetId).get(`${studentId}:${columnId}`) ?? assessmentApplicability(column.assessment_date, this.listStudentEnrollments(studentId));
    if (field === 'grade' && applicability === 'NOT_APPLICABLE' && grade !== (current?.value ?? '')) throw new Error('NOT_APPLICABLE_GRADE');
    const observation = field === 'observation' ? value : current?.observation ?? '';
    if (!grade && !observation) {
      this.db.prepare('DELETE FROM worksheet_values WHERE worksheet_id = ? AND student_id = ? AND column_id = ?').run(worksheetId, studentId, columnId);
    } else {
      this.db.prepare(`INSERT INTO worksheet_values(worksheet_id, student_id, column_id, value, observation) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(worksheet_id, student_id, column_id) DO UPDATE SET value = excluded.value, observation = excluded.observation`)
        .run(worksheetId, studentId, columnId, grade, observation);
    }
    this.touch(worksheetId);
  }

  clearAssessmentValues(worksheetId: number, columnId: number) {
    this.db.prepare('DELETE FROM worksheet_values WHERE worksheet_id = ? AND column_id = ?').run(worksheetId, columnId);
    this.touch(worksheetId);
  }

  private touch(id: number) { this.db.prepare('UPDATE worksheets SET updated_at = ? WHERE id = ?').run(this.now(), id); }

  private transaction(action: () => void) {
    const depth = this.transactionDepth;
    const savepoint = `edutrack_transaction_${depth}`;
    this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    this.transactionDepth += 1;
    try { action(); this.db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT'); }
    catch (error) {
      if (depth) { this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); this.db.exec(`RELEASE SAVEPOINT ${savepoint}`); }
      else this.db.exec('ROLLBACK');
      throw error;
    } finally { this.transactionDepth -= 1; }
  }

  listTrackingReports(): TrackingReportSummary[] {
    return (this.db.prepare('SELECT r.id, r.course_level, r.trimester, r.report_number, r.created_at, r.updated_at, s.origin FROM tracking_reports r LEFT JOIN report_snapshots s ON s.report_id = r.id ORDER BY r.course_level, r.trimester, r.report_number').all() as Row[])
      .map(row => ({ id: row.id, courseLevel: row.course_level, trimester: row.trimester, sequence: row.report_number, createdAt: row.created_at, updatedAt: row.updated_at, snapshotOrigin: row.origin ?? undefined }));
  }

  getReportSnapshot(reportId: number): { origin: 'issued' | 'reconstructed'; payload: TrackingReportsExport; html: string[] } | null {
    const row = this.db.prepare('SELECT origin, payload_json, html_json FROM report_snapshots WHERE report_id = ?').get(reportId) as Row | undefined;
    return row ? { origin: row.origin, payload: JSON.parse(row.payload_json), html: JSON.parse(row.html_json) } : null;
  }

  private insertSnapshot(reportId: number, origin: 'issued' | 'reconstructed', payload: TrackingReportsExport, html: string[]) {
    this.db.prepare('INSERT INTO report_snapshots(report_id, origin, captured_at, payload_json, html_json) VALUES (?, ?, ?, ?, ?)')
      .run(reportId, origin, this.now(), JSON.stringify(payload), JSON.stringify(html));
  }

  saveIssuedReportSnapshot(reportId: number, payload: TrackingReportsExport, html: string[]) {
    this.getTrackingReport(reportId);
    if (this.getReportSnapshot(reportId)) throw new Error('REPORT_ALREADY_SNAPSHOTTED');
    if (html.length !== payload.students.length || !html.length) throw new Error('INVALID_REPORT_SNAPSHOT');
    this.insertSnapshot(reportId, 'issued', payload, html);
  }

  getReportRoster(reportId: number): Array<{ id: number; name: string }> {
    const row = this.db.prepare('SELECT course_level, roster_snapshot_json FROM tracking_reports WHERE id = ?').get(reportId) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado el informe.');
    return row.roster_snapshot_json ? JSON.parse(row.roster_snapshot_json) : this.listActiveStudents(row.course_level).map(student => ({ id: student.id, name: student.fullName }));
  }

  getLatestReportRoster(courseLevel: CourseLevel, trimester: Trimester) {
    const latest = this.latestReport(courseLevel, trimester);
    return latest ? this.getReportRoster(Number(latest.id)) : this.listActiveStudents(courseLevel).map(student => ({ id: student.id, name: student.fullName }));
  }

  isLatestReportIssued(courseLevel: CourseLevel, trimester: Trimester) {
    const latest = this.latestReport(courseLevel, trimester);
    return Boolean(latest && this.getReportSnapshot(Number(latest.id)));
  }

  compareDelivery(data: FullSeguimentExport, roster = this.getLatestReportRoster(data.course.level, data.trimester.id)) {
    const historical = this.listStudents(data.course.level).filter(student => !roster.some(item => item.id === student.id)).map(student => student.fullName);
    return compareDeliveryRoster(data, roster.map(student => student.name), historical);
  }

  getTrackingReport(id: number): TrackingReportSummary {
    const report = this.listTrackingReports().find(item => item.id === id);
    if (!report) throw new Error('No se ha encontrado el informe.');
    return report;
  }

  private latestReport(courseLevel: CourseLevel, trimester: Trimester) {
    return this.db.prepare('SELECT id, report_number FROM tracking_reports WHERE course_level = ? AND trimester = ? ORDER BY report_number DESC LIMIT 1').get(courseLevel, trimester) as Row | undefined;
  }

  private ensureLatestReport(courseLevel: CourseLevel, trimester: Trimester) {
    const existing = this.latestReport(courseLevel, trimester);
    if (existing) return Number(existing.id);
    const now = this.now();
    const roster = this.listActiveStudents(courseLevel).map(student => ({ id: student.id, name: student.fullName }));
    const result = this.db.prepare('INSERT INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at, roster_snapshot_json) VALUES (?, ?, 1, ?, ?, ?)').run(courseLevel, trimester, now, now, JSON.stringify(roster));
    return Number(result.lastInsertRowid);
  }

  listImports(reportId?: number): ImportedWorksheetSummary[] {
    const sql = `SELECT id, report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, is_elective, is_blocking, is_stale, payload_json FROM imported_worksheets${reportId === undefined ? '' : ' WHERE report_id = ?'} ORDER BY course_level, trimester, subject`;
    return ((reportId === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(reportId)) as Row[]).map(this.mapImport);
  }

  private mapImport = (row: Row): ImportedWorksheetSummary => {
    const payload = row.payload_json ? JSON.parse(row.payload_json) as FullSeguimentExport : null;
    const reportRoster = this.getReportRoster(Number(row.report_id));
    const enabledStudents = payload?.students.filter(student => student.enabled !== false && (payload.version === 1 || student.enrolled !== false || reportRoster.some(item => item.name === student.name))) ?? [];
    const gradeMode = payload?.subject.gradeMode ?? 'NUMERIC';
    const configuration = this.getCenterConfiguration();
    const gradedStudentNames = payload && payload.columns.length > 0
      ? enabledStudents
        .filter(student => payload.columns.every(column => student.applicability?.[column.id] === 'NOT_APPLICABLE' || isCompleteImportedGrade(student.values[column.id] ?? '', gradeMode, configuration.grades, configuration.notEvaluatedValue)))
        .map(student => student.name)
      : [];
    return {
      id: row.id, reportId: row.report_id, courseLevel: row.course_level, trimester: row.trimester, subject: row.subject,
      teacherFirstName: row.teacher_first_name, teacherLastName: row.teacher_last_name,
      exportedAt: row.exported_at, importedAt: row.imported_at, isElective: Boolean(row.is_elective),
      enabledStudentNames: enabledStudents.map(student => student.name), gradedStudentNames, isBlocking: row.is_blocking !== 0,
      isStale: Boolean(row.is_stale) || (payload ? !this.compareDelivery(payload, reportRoster).matches : true)
    };
  };

  hasImport(data: FullSeguimentExport): boolean {
    const report = this.latestReport(data.course.level, data.trimester.id);
    return Boolean(report && this.db.prepare('SELECT 1 FROM imported_worksheets WHERE report_id = ? AND subject = ?').get(report.id, data.subject.name));
  }

  assertDeliveryApplicability(data: FullSeguimentExport) {
    const comparison = this.compareDelivery(data);
    if (!comparison.matches) throw new Error(deliveryRosterError(comparison));
    const roster = this.getLatestReportRoster(data.course.level, data.trimester.id);
    for (const member of roster) {
      const startedOn = this.listStudentEnrollments(member.id).at(-1)?.startedOn;
      if (!startedOn) continue;
      if (data.version !== 2 || data.exportedAt.slice(0, 10) < startedOn) throw new Error('El listado ha cambiado. Actualiza y reexporta la entrega en formato v2 después de la fecha efectiva.');
      const student = data.students.find(item => item.name === member.name);
      if (!student) continue;
      for (const column of data.columns.filter(item => item.assessmentDate && item.assessmentDate < startedOn)) {
        if (student.applicability?.[column.id] !== 'NOT_APPLICABLE' || student.values[column.id]?.trim()) throw new Error(`La evaluación “${column.name}” es anterior al alta de “${member.name}” y debe figurar como no aplicable, sin nota.`);
      }
    }
  }

  saveImport(data: FullSeguimentExport, replace: boolean) {
    const normalizedData = normalizeImportedNumericGrades(data);
    this.assertDeliveryApplicability(normalizedData);
    this.transaction(() => this.writeImport(normalizedData, replace));
  }

  private writeImport(normalizedData: FullSeguimentExport, replace: boolean) {
    const reportId = this.ensureLatestReport(normalizedData.course.level, normalizedData.trimester.id);
    this.latestMutableReport(reportId);
    const previous = this.db.prepare('SELECT exported_at, is_stale FROM imported_worksheets WHERE report_id = ? AND subject = ?').get(reportId, normalizedData.subject.name) as Row | undefined;
    if (previous?.is_stale && Date.parse(normalizedData.exportedAt) <= Date.parse(previous.exported_at)) throw new Error('La entrega copiada está desactualizada. Actualiza el listado y reexporta un archivo nuevo.');
    const now = this.now();
    const args = [reportId, normalizedData.course.level, normalizedData.trimester.id, normalizedData.subject.name, normalizedData.teacher.firstName, normalizedData.teacher.lastName, normalizedData.exportedAt, now, JSON.stringify(normalizedData), normalizedData.subject.isElective ? 1 : 0];
    if (replace) {
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(report_id, subject) DO UPDATE SET
        teacher_first_name=excluded.teacher_first_name, teacher_last_name=excluded.teacher_last_name,
        exported_at=excluded.exported_at, imported_at=excluded.imported_at, payload_json=excluded.payload_json, is_elective=excluded.is_elective, is_stale=0`).run(...args);
    } else {
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...args);
    }
    // An exclusion may have been recorded before the teaching delivery arrived.
    this.db.prepare(`UPDATE imported_worksheets SET is_blocking = 0 WHERE report_id = ? AND subject = ?
      AND EXISTS (SELECT 1 FROM report_subject_exclusions WHERE report_id = ? AND subject = ?)`)
      .run(reportId, normalizedData.subject.name, reportId, normalizedData.subject.name);
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(now, reportId);
  }

  setImportedWorksheetBlocking(id: number, isBlocking: boolean) {
    const row = this.db.prepare('SELECT report_id, subject FROM imported_worksheets WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la entrega importada.');
    this.latestMutableReport(Number(row.report_id));
    const now = this.now();
    this.db.prepare('UPDATE imported_worksheets SET is_blocking = ? WHERE id = ?').run(isBlocking ? 1 : 0, id);
    if (isBlocking) this.db.prepare('DELETE FROM report_subject_exclusions WHERE report_id = ? AND subject = ?').run(row.report_id, row.subject);
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(now, row.report_id);
    return this.listImports(row.report_id).find(item => item.id === id)!;
  }

  setReportSubjectExcluded(reportId: number, subject: string, excluded: boolean): ReportSubjectExclusion | null {
    const report = this.getTrackingReport(reportId);
    this.latestMutableReport(reportId);
    if (!this.hasSubject(report.courseLevel, subject)) throw new Error('La asignatura no está configurada para este curso.');
    const imported = this.db.prepare('SELECT id FROM imported_worksheets WHERE report_id = ? AND subject = ?').get(reportId, subject) as Row | undefined;
    if (imported) {
      this.setImportedWorksheetBlocking(Number(imported.id), !excluded);
      return excluded ? { reportId, subject } : null;
    }
    if (excluded) this.db.prepare('INSERT OR IGNORE INTO report_subject_exclusions(report_id, subject) VALUES (?, ?)').run(reportId, subject);
    else this.db.prepare('DELETE FROM report_subject_exclusions WHERE report_id = ? AND subject = ?').run(reportId, subject);
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(this.now(), reportId);
    return excluded ? { reportId, subject } : null;
  }

  getImportedWorksheet(id: number): ImportedWorksheetDetail {
    const row = this.db.prepare('SELECT * FROM imported_worksheets WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la entrega importada.');
    const payload = JSON.parse(row.payload_json) as FullSeguimentExport;
    const trimester = normalizeTrimester(payload.trimester?.id);
    if (trimester) payload.trimester.id = trimester;
    return { ...this.mapImport(row), payload };
  }

  deleteImportedWorksheet(id: number) {
    const row = this.db.prepare('SELECT report_id FROM imported_worksheets WHERE id = ?').get(id) as Row | undefined;
    if (!row) return;
    this.latestMutableReport(Number(row.report_id));
    this.db.prepare('DELETE FROM imported_worksheets WHERE id = ?').run(id);
    if (!(this.db.prepare('SELECT 1 FROM imported_worksheets WHERE report_id = ?').get(row.report_id))) this.db.prepare('DELETE FROM tracking_reports WHERE id = ?').run(row.report_id);
  }

  copyTrackingReport(reportId: number): TrackingReportSummary {
    const source = this.getTrackingReport(reportId);
    if (Number(this.latestReport(source.courseLevel, source.trimester)?.id) !== reportId) throw new Error('ONLY_LATEST_REPORT_CAN_BE_COPIED');
    const nextNumber = Number((this.db.prepare('SELECT COALESCE(MAX(report_number), 0) + 1 value FROM tracking_reports WHERE course_level = ? AND trimester = ?').get(source.courseLevel, source.trimester) as Row).value);
    const now = this.now();
    const oldRoster = this.getReportRoster(reportId);
    const currentRoster = this.listActiveStudents(source.courseLevel).map(student => ({ id: student.id, name: student.fullName }));
    const rosterIdentityChanged = JSON.stringify(oldRoster.map(student => student.id).sort((left, right) => left - right)) !== JSON.stringify(currentRoster.map(student => student.id).sort((left, right) => left - right));
    let newId = 0;
    this.transaction(() => {
      const result = this.db.prepare('INSERT INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at, roster_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)').run(source.courseLevel, source.trimester, nextNumber, now, now, JSON.stringify(currentRoster));
      newId = Number(result.lastInsertRowid);
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective, is_blocking, is_stale)
        SELECT ?, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, ?, payload_json, is_elective, is_blocking, CASE WHEN ? THEN 1 ELSE is_stale END FROM imported_worksheets WHERE report_id = ?`).run(newId, now, rosterIdentityChanged ? 1 : 0, reportId);
      this.db.prepare(`INSERT INTO tutor_observations(report_id, student_id, observation, updated_at)
        SELECT ?, student_id, observation, ? FROM tutor_observations WHERE report_id = ?`).run(newId, now, reportId);
      this.db.prepare(`INSERT INTO report_subject_exclusions(report_id, subject)
        SELECT ?, subject FROM report_subject_exclusions WHERE report_id = ?`).run(newId, reportId);
    });
    return this.getTrackingReport(newId);
  }

  deleteTrackingReport(reportId: number) {
    const report = this.db.prepare('SELECT course_level, trimester FROM tracking_reports WHERE id = ?').get(reportId) as Row | undefined;
    if (!report) return;
    const latest = this.latestReport(report.course_level, report.trimester);
    if (!latest || Number(latest.id) !== reportId) throw new Error('ONLY_LATEST_REPORT_CAN_BE_DELETED');
    this.db.prepare('DELETE FROM tracking_reports WHERE id = ?').run(reportId);
  }

  getInitialState(): InitialState {
    return { profile: this.getProfile(), language: this.getLanguage(), schoolLogo: this.getSchoolLogo(), centerConfiguration: this.getCenterConfiguration(), courses: this.listCourses(), subjects: this.listSubjects(), students: this.listStudents(), worksheets: this.listWorksheets(), trackingReports: this.listTrackingReports(), imports: this.listImports(), reportSubjectExclusions: this.listReportSubjectExclusions(), tutorObservations: this.listTutorObservations() };
  }
}

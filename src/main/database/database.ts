import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { COURSE_LABELS, COURSE_LEVELS, normalizeTrimester, SUBJECTS_BY_COURSE, type CourseLevel, type Trimester } from '../../shared/catalogs/catalogs';
import { DEFAULT_CENTER_CONFIGURATION, normalizeCenterConfiguration } from '../../shared/center/center-configuration';
import { isCompleteGradeValue, normalizeGradeValue } from '../../shared/grades/grades';
import type { AppLanguage, AssessmentKind, CenterConfiguration, ConfiguredCourse, ConfiguredSubject, FullSeguimentExport, GradeMode, ImportedWorksheetDetail, ImportedWorksheetSummary, InitialState, Student, TeacherProfile, TrackingReportSummary, WorksheetChangeSummary, WorksheetDetail, WorksheetSummary } from '../../shared/types/models';

type Row = Record<string, any>;

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

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
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
      CREATE TABLE IF NOT EXISTS tracking_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, course_level TEXT NOT NULL, trimester TEXT NOT NULL,
        report_number INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(course_level, trimester, report_number)
      );
      CREATE TABLE IF NOT EXISTS imported_worksheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL REFERENCES tracking_reports(id) ON DELETE CASCADE,
        course_level TEXT NOT NULL, trimester TEXT NOT NULL, subject TEXT NOT NULL,
        teacher_first_name TEXT NOT NULL, teacher_last_name TEXT NOT NULL, exported_at TEXT NOT NULL,
        imported_at TEXT NOT NULL, payload_json TEXT NOT NULL, is_elective INTEGER NOT NULL DEFAULT 0, is_blocking INTEGER NOT NULL DEFAULT 1,
        UNIQUE(report_id, subject)
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

  private latestMutableReport(reportId: number) {
    const report = this.db.prepare('SELECT id, course_level, trimester FROM tracking_reports WHERE id = ?').get(reportId) as Row | undefined;
    if (!report) throw new Error('No se ha encontrado el informe.');
    const latest = this.latestReport(report.course_level, report.trimester);
    if (!latest || Number(latest.id) !== reportId) throw new Error('READ_ONLY_REPORT');
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
    const inUse = new Set((this.db.prepare(`SELECT course_level FROM students UNION SELECT course_level FROM worksheets UNION SELECT course_level FROM imported_worksheets`).all() as Row[]).map(row => row.course_level));
    const retained = cleaned.map((name, index) => {
      const defaultId = COURSE_LEVELS.find(courseId => COURSE_LABELS[courseId].toLocaleLowerCase() === name.toLocaleLowerCase());
      return { id: byName.get(name.toLocaleLowerCase())?.id ?? defaultId ?? `course_${randomUUID()}`, name, sortOrder: index };
    });
    const retainedIds = new Set(retained.map(course => course.id));
    const blocked = existing.filter(course => inUse.has(course.id) && !retainedIds.has(course.id));
    if (blocked.length) throw new Error(`No se pueden eliminar cursos con datos: ${blocked.map(course => course.name).join(', ')}.`);
    const upsert = this.db.prepare(`INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`);
    const remove = this.db.prepare('DELETE FROM configured_courses WHERE id = ?');
    this.transaction(() => {
      retained.forEach(course => upsert.run(course.id, course.name, course.sortOrder));
      existing.filter(course => !retainedIds.has(course.id)).forEach(course => remove.run(course.id));
    });
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
    for (const [courseId, subjects] of grouped) {
      const used = (this.db.prepare('SELECT DISTINCT subject FROM worksheets WHERE course_level = ?').all(courseId) as Row[]).map(row => row.subject as string);
      const missing = used.filter(subject => !subjects.some(item => item.toLocaleLowerCase() === subject.toLocaleLowerCase()));
      if (missing.length) throw new Error(`No se pueden eliminar asignaturas con hojas: ${missing.join(', ')}.`);
    }
    const remove = this.db.prepare('DELETE FROM configured_subjects WHERE course_id = ?');
    const insert = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
    this.transaction(() => grouped.forEach((subjects, courseId) => { remove.run(courseId); subjects.forEach((subject, index) => insert.run(courseId, subject, index)); }));
    return this.listSubjects();
  }

  replaceCenterData(input: Array<{ name: string; subjects: string[]; students: string[] }>, centerConfiguration: CenterConfiguration = DEFAULT_CENTER_CONFIGURATION) {
    const cleaned = input.map(course => ({ name: course.name.trim(), subjects: [...new Set(course.subjects.map(value => value.trim()).filter(Boolean))], students: [...new Set(course.students.map(value => value.trim()).filter(Boolean))] })).filter(course => course.name);
    if (!cleaned.length) throw new Error('El archivo no contiene cursos.');
    const existingCourses = this.listCourses(); const byName = new Map(existingCourses.map(course => [course.name.toLocaleLowerCase(), course]));
    const resolved = cleaned.map((course, sortOrder) => {
      const defaultId = COURSE_LEVELS.find(courseId => COURSE_LABELS[courseId].toLocaleLowerCase() === course.name.toLocaleLowerCase());
      return { ...course, id: byName.get(course.name.toLocaleLowerCase())?.id ?? defaultId ?? `course_${randomUUID()}`, sortOrder };
    });
    const retainedIds = new Set(resolved.map(course => course.id));
    const inUse = new Set((this.db.prepare(`SELECT course_level FROM students UNION SELECT course_level FROM worksheets UNION SELECT course_level FROM imported_worksheets`).all() as Row[]).map(row => row.course_level));
    const blockedCourses = existingCourses.filter(course => inUse.has(course.id) && !retainedIds.has(course.id));
    if (blockedCourses.length) throw new Error(`No se pueden eliminar cursos con datos: ${blockedCourses.map(course => course.name).join(', ')}.`);
    for (const course of resolved) {
      if (!course.subjects.length || !course.students.length) throw new Error(`El curso “${course.name}” debe incluir asignaturas y alumnos.`);
      const usedSubjects = (this.db.prepare('SELECT DISTINCT subject FROM worksheets WHERE course_level = ?').all(course.id) as Row[]).map(row => row.subject as string);
      const missing = usedSubjects.filter(subject => !course.subjects.some(item => item.toLocaleLowerCase() === subject.toLocaleLowerCase()));
      if (missing.length) throw new Error(`No se pueden eliminar asignaturas con hojas: ${missing.join(', ')}.`);
    }
    const upsertCourse = this.db.prepare(`INSERT INTO configured_courses(id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`);
    const removeCourse = this.db.prepare('DELETE FROM configured_courses WHERE id = ?'); const removeSubjects = this.db.prepare('DELETE FROM configured_subjects WHERE course_id = ?');
    const addSubject = this.db.prepare('INSERT INTO configured_subjects(course_id, name, sort_order) VALUES (?, ?, ?)');
    const updateStudentOrder = this.db.prepare('UPDATE students SET sort_order = ? WHERE id = ?'); const addStudent = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)'); const removeStudent = this.db.prepare('DELETE FROM students WHERE id = ?');
    const existingStudents = new Map(resolved.map(course => [course.id, this.listStudents(course.id)]));
    this.transaction(() => {
      resolved.forEach(course => upsertCourse.run(course.id, course.name, course.sortOrder));
      existingCourses.filter(course => !retainedIds.has(course.id)).forEach(course => removeCourse.run(course.id));
      resolved.forEach(course => {
        removeSubjects.run(course.id); course.subjects.forEach((subject, index) => addSubject.run(course.id, subject, index));
        const available = (existingStudents.get(course.id) ?? []).reduce<Map<string, Student[]>>((map, student) => { const matches = map.get(student.fullName) ?? []; matches.push(student); map.set(student.fullName, matches); return map; }, new Map());
        const retainedStudents = new Set<number>();
        course.students.forEach((name, index) => { const match = available.get(name)?.shift(); if (match) { retainedStudents.add(match.id); updateStudentOrder.run(index, match.id); } else addStudent.run(course.id, name, index, this.now()); });
        (existingStudents.get(course.id) ?? []).filter(student => !retainedStudents.has(student.id)).forEach(student => removeStudent.run(student.id));
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

  addStudent(courseLevel: CourseLevel, fullName: string): Student {
    const name = fullName.trim();
    if (!name) throw new Error('El nombre del alumno no puede estar vacío.');
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM students WHERE course_level = ?').get(courseLevel) as Row).n;
    const result = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)')
      .run(courseLevel, name, next, this.now());
    return this.listStudents(courseLevel).find(s => s.id === Number(result.lastInsertRowid))!;
  }

  updateStudent(id: number, fullName: string): Student {
    const name = fullName.trim();
    if (!name) throw new Error('El nombre del alumno no puede estar vacío.');
    this.db.prepare('UPDATE students SET full_name = ? WHERE id = ?').run(name, id);
    const row = this.db.prepare('SELECT id, course_level, full_name, sort_order FROM students WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado el alumno.');
    return { id: row.id, courseLevel: row.course_level, fullName: row.full_name, sortOrder: row.sort_order };
  }

  deleteStudent(id: number) { this.db.prepare('DELETE FROM students WHERE id = ?').run(id); }

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
    const cleaned = names.map(name => name.trim()).filter(Boolean);
    if (cleaned.length === 0) throw new Error('La lista debe contener al menos un alumno.');
    const existing = this.listStudents(courseLevel);
    const available = existing.reduce<Map<string, Student[]>>((map, student) => {
      const entries = map.get(student.fullName) ?? [];
      entries.push(student); map.set(student.fullName, entries); return map;
    }, new Map());
    const retained = new Set<number>();
    const update = this.db.prepare('UPDATE students SET sort_order = ? WHERE id = ?');
    const insert = this.db.prepare('INSERT INTO students(course_level, full_name, sort_order, created_at) VALUES (?, ?, ?, ?)');
    const remove = this.db.prepare('DELETE FROM students WHERE id = ?');
    this.transaction(() => {
      cleaned.forEach((name, index) => {
        const match = available.get(name)?.shift();
        if (match) { retained.add(match.id); update.run(index, match.id); }
        else insert.run(courseLevel, name, index, this.now());
      });
      existing.filter(student => !retained.has(student.id)).forEach(student => remove.run(student.id));
    });
    return this.listStudents(courseLevel);
  }

  listWorksheets(): WorksheetSummary[] {
    const summaries = (this.db.prepare(`SELECT w.*,
      (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id AND c.kind = 'EXAM') AS exam_count,
      (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id AND c.kind = 'CONTINUOUS_ASSESSMENT') AS continuous_count,
      CASE WHEN (SELECT COUNT(*) FROM students s WHERE s.course_level = w.course_level
          AND (w.is_elective = 0 OR NOT EXISTS (SELECT 1 FROM worksheet_disabled_students d WHERE d.worksheet_id = w.id AND d.student_id = s.id))) > 0
        AND (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id) > 0
        AND (SELECT COUNT(*) FROM worksheet_values v WHERE v.worksheet_id = w.id
          AND (w.is_elective = 0 OR NOT EXISTS (SELECT 1 FROM worksheet_disabled_students d WHERE d.worksheet_id = w.id AND d.student_id = v.student_id))
          AND TRIM(v.value) <> ''
          AND (w.grade_mode = 'LETTER' OR (
            TRIM(v.value) NOT GLOB '*[^0-9.,]*'
            AND REPLACE(TRIM(v.value), ',', '.') NOT IN ('.', '')
            AND LENGTH(REPLACE(TRIM(v.value), ',', '.')) - LENGTH(REPLACE(REPLACE(TRIM(v.value), ',', '.'), '.', '')) <= 1
            AND CAST(REPLACE(TRIM(v.value), ',', '.') AS REAL) BETWEEN 0 AND 10))) =
          (SELECT COUNT(*) FROM students s WHERE s.course_level = w.course_level
            AND (w.is_elective = 0 OR NOT EXISTS (SELECT 1 FROM worksheet_disabled_students d WHERE d.worksheet_id = w.id AND d.student_id = s.id)))
          * (SELECT COUNT(*) FROM worksheet_columns c WHERE c.worksheet_id = w.id)
      THEN 1 ELSE 0 END AS is_complete
      FROM worksheets w ORDER BY w.course_level, w.trimester, w.subject`).all() as Row[]).map(this.mapWorksheet);
    return summaries.map(summary => ({ ...summary, isComplete: this.isWorksheetComplete(summary), changeSummary: summary.copiedFromId ? this.getWorksheetChanges(summary.id, summary.copiedFromId) : undefined }));
  }

  private isWorksheetComplete(worksheet: WorksheetSummary) {
    const columns = (this.db.prepare('SELECT id, assessment_date FROM worksheet_columns WHERE worksheet_id = ?').all(worksheet.id) as Row[]).map(row => ({ id: Number(row.id), assessmentDate: row.assessment_date as string }));
    const students = (this.db.prepare(`SELECT id FROM students s WHERE s.course_level = ? AND (? = 0 OR NOT EXISTS (SELECT 1 FROM worksheet_disabled_students d WHERE d.worksheet_id = ? AND d.student_id = s.id))`).all(worksheet.courseLevel, worksheet.isElective ? 1 : 0, worksheet.id) as Row[]).map(row => Number(row.id));
    if (!columns.length || !students.length || (worksheet.copiedFromId && columns.some(column => !column.assessmentDate))) return false;
    const values = new Map((this.db.prepare('SELECT student_id, column_id, value FROM worksheet_values WHERE worksheet_id = ?').all(worksheet.id) as Row[]).map(row => [`${row.student_id}:${row.column_id}`, row.value as string]));
    const configuration = this.getCenterConfiguration();
    return students.every(studentId => columns.every(column => isCompleteGradeValue(values.get(`${studentId}:${column.id}`) ?? '', worksheet.gradeMode, configuration.grades, configuration.notEvaluatedValue)));
  }

  private mapWorksheet = (row: Row): WorksheetSummary => ({
    id: row.id, courseLevel: row.course_level, trimester: row.trimester, subject: row.subject, gradeMode: row.grade_mode === 'LETTER' ? 'LETTER' : 'NUMERIC', isElective: Boolean(row.is_elective),
    createdAt: row.created_at, updatedAt: row.updated_at, isComplete: Boolean(row.is_complete), examCount: Number(row.exam_count ?? 0), continuousAssessmentCount: Number(row.continuous_count ?? 0), copiedFromId: row.copied_from_id === null || row.copied_from_id === undefined ? undefined : Number(row.copied_from_id)
  });

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
    return JSON.stringify(this.listStudents(courseLevel).map(student => student.fullName));
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
        this.db.prepare('UPDATE worksheets SET grade_mode = ?, is_elective = ?, updated_at = ?, copied_from_id = NULL, roster_snapshot_json = ? WHERE id = ?')
          .run(gradeMode, isElective ? 1 : 0, now, this.rosterSnapshot(normalized.course.level), worksheetId);
      } else {
        const result = this.db.prepare('INSERT INTO worksheets(course_level, trimester, subject, grade_mode, is_elective, created_at, updated_at, roster_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(normalized.course.level, targetTrimester, normalized.subject.name, gradeMode, isElective ? 1 : 0, now, now, this.rosterSnapshot(normalized.course.level));
        worksheetId = Number(result.lastInsertRowid);
      }
      const insertColumn = this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
      const columnIds = new Map<string, number>();
      normalized.columns.forEach((column, index) => {
        const inserted = insertColumn.run(worksheetId, column.id, column.name.trim(), column.kind ?? 'CONTINUOUS_ASSESSMENT', column.assessmentDate ?? '', index);
        columnIds.set(column.id, Number(inserted.lastInsertRowid));
      });
      const disableStudent = this.db.prepare('INSERT INTO worksheet_disabled_students(worksheet_id, student_id) VALUES (?, ?)');
      const insertValue = this.db.prepare('INSERT INTO worksheet_values(worksheet_id, student_id, column_id, value, observation) VALUES (?, ?, ?, ?, ?)');
      for (const { student, id } of importedStudentIds) {
        if (isElective && student.enabled === false) disableStudent.run(worksheetId, id);
        for (const column of normalized.columns) {
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
      const insertColumn = this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order, source_column_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const sourceColumns = this.db.prepare('SELECT id, name, kind, sort_order FROM worksheet_columns WHERE worksheet_id = ? ORDER BY sort_order, id').all(worksheetId) as Row[];
      sourceColumns.forEach(column => insertColumn.run(newId, `col_${randomUUID()}`, column.name, column.kind, '', column.sort_order, column.id));
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
      .map(row => ({ id: row.id, worksheetId: row.worksheet_id, exportId: row.export_id, name: row.name, kind: row.kind ?? 'CONTINUOUS_ASSESSMENT', assessmentDate: row.assessment_date ?? '', sortOrder: row.sort_order, sourceColumnId: row.source_column_id === null || row.source_column_id === undefined ? undefined : Number(row.source_column_id) }));
    const values: Record<string, string> = {};
    const observations: Record<string, string> = {};
    for (const row of this.db.prepare('SELECT student_id, column_id, value, observation FROM worksheet_values WHERE worksheet_id = ?').all(id) as Row[]) {
      values[`${row.student_id}:${row.column_id}`] = row.value;
      observations[`${row.student_id}:${row.column_id}`] = row.observation;
    }
    const summary = this.listWorksheets().find(item => item.id === id)!;
    const disabledStudentIds = (this.db.prepare('SELECT student_id FROM worksheet_disabled_students WHERE worksheet_id = ? ORDER BY student_id').all(id) as Row[]).map(row => Number(row.student_id));
    return { ...summary, students: this.listStudents(worksheet.course_level), columns, values, observations, disabledStudentIds };
  }

  configureElectiveStudents(worksheetId: number, enabledStudentIds: number[]): WorksheetDetail {
    const worksheet = this.db.prepare('SELECT course_level, is_elective FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!worksheet || !worksheet.is_elective) throw new Error('La asignatura no es optativa.');
    const students = this.listStudents(worksheet.course_level);
    const validIds = new Set(students.map(student => student.id));
    const enabled = new Set(enabledStudentIds);
    if (enabled.size === 0 || enabled.size !== enabledStudentIds.length || [...enabled].some(id => !Number.isInteger(id) || !validIds.has(id))) throw new Error('Selección de alumnado no válida.');
    const disable = this.db.prepare('INSERT INTO worksheet_disabled_students(worksheet_id, student_id) VALUES (?, ?)');
    this.transaction(() => {
      this.db.prepare('DELETE FROM worksheet_disabled_students WHERE worksheet_id = ?').run(worksheetId);
      students.filter(student => !enabled.has(student.id)).forEach(student => disable.run(worksheetId, student.id));
      this.touch(worksheetId);
    });
    return this.getWorksheet(worksheetId);
  }

  addAssessment(worksheetId: number, kind: AssessmentKind, name: string, assessmentDate: string): WorksheetDetail {
    const clean = name.trim();
    if (!clean) throw new Error('El nombre de la columna no puede estar vacío.');
    if (!['EXAM', 'CONTINUOUS_ASSESSMENT'].includes(kind)) throw new Error('Tipo de evaluación no válido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) throw new Error('La fecha de realización no es válida.');
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM worksheet_columns WHERE worksheet_id = ?').get(worksheetId) as Row).n;
    this.db.prepare('INSERT INTO worksheet_columns(worksheet_id, export_id, name, kind, assessment_date, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(worksheetId, `col_${randomUUID()}`, clean, kind, assessmentDate, next);
    this.touch(worksheetId);
    return this.getWorksheet(worksheetId);
  }

  updateAssessment(id: number, input: { kind: AssessmentKind; name: string; assessmentDate: string }) {
    const clean = input.name.trim();
    if (!clean || !['EXAM', 'CONTINUOUS_ASSESSMENT'].includes(input.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(input.assessmentDate)) throw new Error('Datos de evaluación no válidos.');
    const row = this.db.prepare('SELECT worksheet_id FROM worksheet_columns WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la evaluación.');
    this.db.prepare('UPDATE worksheet_columns SET name = ?, kind = ?, assessment_date = ? WHERE id = ?').run(clean, input.kind, input.assessmentDate, id);
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
    const worksheet = this.db.prepare('SELECT grade_mode FROM worksheets WHERE id = ?').get(worksheetId) as Row | undefined;
    if (!worksheet) throw new Error('No se ha encontrado la hoja.');
    const current = this.db.prepare('SELECT value, observation FROM worksheet_values WHERE worksheet_id = ? AND student_id = ? AND column_id = ?')
      .get(worksheetId, studentId, columnId) as Row | undefined;
    const configuration = this.getCenterConfiguration();
    const grade = field === 'grade' ? normalizeGradeValue(value) : current?.value ?? '';
    if (field === 'grade' && grade && !isCompleteGradeValue(grade, worksheet.grade_mode === 'LETTER' ? 'LETTER' : 'NUMERIC', configuration.grades, configuration.notEvaluatedValue)) throw new Error('INVALID_GRADE_VALUE');
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
    this.db.exec('BEGIN');
    try { action(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  listTrackingReports(): TrackingReportSummary[] {
    return (this.db.prepare('SELECT id, course_level, trimester, report_number, created_at, updated_at FROM tracking_reports ORDER BY course_level, trimester, report_number').all() as Row[])
      .map(row => ({ id: row.id, courseLevel: row.course_level, trimester: row.trimester, sequence: row.report_number, createdAt: row.created_at, updatedAt: row.updated_at }));
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
    const result = this.db.prepare('INSERT INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(courseLevel, trimester, now, now);
    return Number(result.lastInsertRowid);
  }

  listImports(reportId?: number): ImportedWorksheetSummary[] {
    const sql = `SELECT id, report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, is_elective, is_blocking, payload_json FROM imported_worksheets${reportId === undefined ? '' : ' WHERE report_id = ?'} ORDER BY course_level, trimester, subject`;
    return ((reportId === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(reportId)) as Row[]).map(this.mapImport);
  }

  private mapImport = (row: Row): ImportedWorksheetSummary => {
    const payload = row.payload_json ? JSON.parse(row.payload_json) as FullSeguimentExport : null;
    const enabledStudents = payload?.students.filter(student => student.enabled !== false) ?? [];
    const gradeMode = payload?.subject.gradeMode ?? 'NUMERIC';
    const configuration = this.getCenterConfiguration();
    const gradedStudentNames = payload && payload.columns.length > 0
      ? enabledStudents
        .filter(student => payload.columns.every(column => isCompleteImportedGrade(student.values[column.id] ?? '', gradeMode, configuration.grades, configuration.notEvaluatedValue)))
        .map(student => student.name)
      : [];
    return {
      id: row.id, reportId: row.report_id, courseLevel: row.course_level, trimester: row.trimester, subject: row.subject,
      teacherFirstName: row.teacher_first_name, teacherLastName: row.teacher_last_name,
      exportedAt: row.exported_at, importedAt: row.imported_at, isElective: Boolean(row.is_elective),
      enabledStudentNames: enabledStudents.map(student => student.name), gradedStudentNames, isBlocking: row.is_blocking !== 0
    };
  };

  hasImport(data: FullSeguimentExport): boolean {
    const report = this.latestReport(data.course.level, data.trimester.id);
    return Boolean(report && this.db.prepare('SELECT 1 FROM imported_worksheets WHERE report_id = ? AND subject = ?').get(report.id, data.subject.name));
  }

  saveImport(data: FullSeguimentExport, replace: boolean) {
    const normalizedData = normalizeImportedNumericGrades(data);
    const reportId = this.ensureLatestReport(normalizedData.course.level, normalizedData.trimester.id);
    const now = this.now();
    const args = [reportId, normalizedData.course.level, normalizedData.trimester.id, normalizedData.subject.name, normalizedData.teacher.firstName, normalizedData.teacher.lastName, normalizedData.exportedAt, now, JSON.stringify(normalizedData), normalizedData.subject.isElective ? 1 : 0];
    if (replace) {
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(report_id, subject) DO UPDATE SET
        teacher_first_name=excluded.teacher_first_name, teacher_last_name=excluded.teacher_last_name,
        exported_at=excluded.exported_at, imported_at=excluded.imported_at, payload_json=excluded.payload_json, is_elective=excluded.is_elective`).run(...args);
    } else {
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...args);
    }
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(now, reportId);
  }

  setImportedWorksheetBlocking(id: number, isBlocking: boolean) {
    const row = this.db.prepare('SELECT report_id FROM imported_worksheets WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('No se ha encontrado la entrega importada.');
    this.latestMutableReport(Number(row.report_id));
    const now = this.now();
    this.db.prepare('UPDATE imported_worksheets SET is_blocking = ? WHERE id = ?').run(isBlocking ? 1 : 0, id);
    this.db.prepare('UPDATE tracking_reports SET updated_at = ? WHERE id = ?').run(now, row.report_id);
    return this.listImports(row.report_id).find(item => item.id === id)!;
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
    let newId = 0;
    this.transaction(() => {
      const result = this.db.prepare('INSERT INTO tracking_reports(course_level, trimester, report_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(source.courseLevel, source.trimester, nextNumber, now, now);
      newId = Number(result.lastInsertRowid);
      this.db.prepare(`INSERT INTO imported_worksheets(report_id, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, imported_at, payload_json, is_elective, is_blocking)
        SELECT ?, course_level, trimester, subject, teacher_first_name, teacher_last_name, exported_at, ?, payload_json, is_elective, is_blocking FROM imported_worksheets WHERE report_id = ?`).run(newId, now, reportId);
      this.db.prepare(`INSERT INTO tutor_observations(report_id, student_id, observation, updated_at)
        SELECT ?, student_id, observation, ? FROM tutor_observations WHERE report_id = ?`).run(newId, now, reportId);
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
    return { profile: this.getProfile(), language: this.getLanguage(), schoolLogo: this.getSchoolLogo(), centerConfiguration: this.getCenterConfiguration(), courses: this.listCourses(), subjects: this.listSubjects(), students: this.listStudents(), worksheets: this.listWorksheets(), trackingReports: this.listTrackingReports(), imports: this.listImports(), tutorObservations: this.listTutorObservations() };
  }
}

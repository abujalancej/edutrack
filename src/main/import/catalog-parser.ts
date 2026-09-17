export type CourseCatalogParseResult = { ok: true; names: string[] } | { ok: false; error: string };
export type SubjectCatalogParseResult = { ok: true; entries: Array<{ course: string; subject: string }> } | { ok: false; error: string };
export interface CenterCourseData { name: string; subjects: string[]; students: string[] }
import { DEFAULT_CENTER_CONFIGURATION, normalizeCenterConfiguration } from '../../shared/center/center-configuration';
import type { CenterConfiguration } from '../../shared/types/models';

export type CenterDataParseResult = { ok: true; courses: CenterCourseData[]; centerConfiguration: CenterConfiguration } | { ok: false; error: string };

export function parseCenterFile(content: string, extension: string): CenterDataParseResult {
  try {
    const { courses, centerConfiguration } = extension.toLowerCase() === '.json' ? parseCenterJson(content) : { courses: parseCenterCsv(content), centerConfiguration: DEFAULT_CENTER_CONFIGURATION };
    if (!courses.length) return { ok: false, error: 'El archivo no contiene cursos.' };
    for (const course of courses) {
      if (!course.subjects.length) return { ok: false, error: `El curso “${course.name}” no contiene asignaturas.` };
      if (!course.students.length) return { ok: false, error: `El curso “${course.name}” no contiene alumnos.` };
      const seen = new Set<string>();
      for (const student of course.students) {
        const key = student.trim().toLocaleLowerCase();
        if (!key || seen.has(key)) return { ok: false, error: `Nombre de alumno vacío o duplicado en “${course.name}”: ${student}.` };
        seen.add(key);
      }
    }
    return { ok: true, courses, centerConfiguration };
  } catch (error) { return { ok: false, error: message(error) }; }
}

export function parseCoursesFile(content: string, extension: string): CourseCatalogParseResult {
  try {
    const names = extension.toLowerCase() === '.json' ? parseCourseJson(content) : parseCourseCsv(content);
    const cleaned = unique(names);
    return cleaned.length ? { ok: true, names: cleaned } : { ok: false, error: 'El archivo no contiene cursos.' };
  } catch (error) { return { ok: false, error: message(error) }; }
}

export function parseSubjectsFile(content: string, extension: string): SubjectCatalogParseResult {
  try {
    const entries = extension.toLowerCase() === '.json' ? parseSubjectJson(content) : parseSubjectCsv(content);
    const cleaned = entries.map(entry => ({ course: entry.course.trim(), subject: entry.subject.trim() })).filter(entry => entry.course && entry.subject);
    return cleaned.length ? { ok: true, entries: cleaned } : { ok: false, error: 'El archivo no contiene asignaturas.' };
  } catch (error) { return { ok: false, error: message(error) }; }
}

function parseCourseJson(content: string): string[] {
  const value = json(content);
  const list = Array.isArray(value) ? value : object(value) && Array.isArray(value.courses) ? value.courses : null;
  if (!list) throw new Error('El JSON debe ser un array o tener una propiedad “courses”.');
  return list.map((entry, index) => {
    if (typeof entry === 'string') return entry;
    if (object(entry) && typeof (entry.name ?? entry.nombre ?? entry.nom) === 'string') return (entry.name ?? entry.nombre ?? entry.nom) as string;
    throw new Error(`El curso de la posición ${index + 1} no tiene nombre.`);
  });
}

function parseCourseCsv(content: string) {
  const rows = csvRows(content).filter(row => row.some(cell => cell.trim()));
  if (!rows.length) return [];
  const headers = rows[0].map(normalize); const index = headers.findIndex(header => ['curso', 'curs', 'course', 'nivel', 'nivell'].includes(header));
  return rows.slice(index >= 0 ? 1 : 0).map(row => row[index >= 0 ? index : 0] ?? '');
}

function parseSubjectJson(content: string): Array<{ course: string; subject: string }> {
  const value = json(content);
  if (Array.isArray(value)) return value.map((entry, index) => {
    if (!object(entry)) throw new Error(`La asignatura de la posición ${index + 1} no es válida.`);
    const course = entry.course ?? entry.curso ?? entry.curs; const subject = entry.subject ?? entry.asignatura ?? entry.assignatura ?? entry.name ?? entry.nombre ?? entry.nom;
    if (typeof course !== 'string' || typeof subject !== 'string') throw new Error(`La asignatura de la posición ${index + 1} debe indicar curso y nombre.`);
    return { course, subject };
  });
  const map = object(value) && object(value.subjects) ? value.subjects : value;
  if (!object(map)) throw new Error('El JSON de asignaturas no es válido.');
  return Object.entries(map).flatMap(([course, subjects]) => {
    if (!Array.isArray(subjects)) throw new Error(`Las asignaturas de “${course}” deben ser un array.`);
    return subjects.map(subject => {
      const name = typeof subject === 'string' ? subject : object(subject) ? subject.name ?? subject.nombre ?? subject.nom : null;
      if (typeof name !== 'string') throw new Error(`Hay una asignatura sin nombre en “${course}”.`);
      return { course, subject: name };
    });
  });
}

function parseSubjectCsv(content: string): Array<{ course: string; subject: string }> {
  const rows = csvRows(content).filter(row => row.some(cell => cell.trim()));
  if (!rows.length) return [];
  const headers = rows[0].map(normalize);
  const courseIndex = headers.findIndex(header => ['curso', 'curs', 'course', 'nivel', 'nivell'].includes(header));
  const subjectIndex = headers.findIndex(header => ['asignatura', 'assignatura', 'subject', 'materia'].includes(header));
  if (courseIndex < 0 || subjectIndex < 0) throw new Error('El CSV debe incluir las columnas “Curso” y “Asignatura”.');
  return rows.slice(1).map(row => ({ course: row[courseIndex] ?? '', subject: row[subjectIndex] ?? '' }));
}

function parseCenterJson(content: string): { courses: CenterCourseData[]; centerConfiguration: CenterConfiguration } {
  const value = json(content); const root = object(value) ? value : null; const list = root && Array.isArray(root.courses) ? root.courses : Array.isArray(value) ? value : null;
  if (!list) throw new Error('El JSON debe tener una propiedad “courses” con un array.');
  const courses = list.map((entry, index) => {
    if (!object(entry)) throw new Error(`El curso de la posición ${index + 1} no es válido.`);
    const name = entry.name ?? entry.nombre ?? entry.nom; const subjects = entry.subjects ?? entry.asignaturas ?? entry.assignatures; const students = entry.students ?? entry.alumnos ?? entry.alumnes;
    if (typeof name !== 'string' || !Array.isArray(subjects) || !Array.isArray(students)) throw new Error(`El curso de la posición ${index + 1} debe incluir nombre, asignaturas y alumnos.`);
    return { name: name.trim(), subjects: unique(subjects.map(textEntry)), students: students.map(textEntry).map(value => value.trim()) };
  });
  return { courses, centerConfiguration: parseCenterConfiguration(root) };
}

function parseCenterConfiguration(root: Record<string, unknown> | null): CenterConfiguration {
  if (!root) return { ...DEFAULT_CENTER_CONFIGURATION };
  const hasNestedWeights = Object.prototype.hasOwnProperty.call(root, 'assessmentWeights');
  const hasLegacyWeights = Object.prototype.hasOwnProperty.call(root, 'examWeight') || Object.prototype.hasOwnProperty.call(root, 'continuousAssessmentWeight');
  const hasAssessmentWeights = hasNestedWeights || hasLegacyWeights;
  let examWeight: unknown = DEFAULT_CENTER_CONFIGURATION.examWeight;
  let continuousAssessmentWeight: unknown = DEFAULT_CENTER_CONFIGURATION.continuousAssessmentWeight;
  if (hasNestedWeights) {
    if (!object(root.assessmentWeights) || !Object.prototype.hasOwnProperty.call(root.assessmentWeights, 'exam') || !Object.prototype.hasOwnProperty.call(root.assessmentWeights, 'continuousAssessment')) throw new Error('“assessmentWeights” debe incluir “exam” y “continuousAssessment”.');
    examWeight = root.assessmentWeights.exam;
    continuousAssessmentWeight = root.assessmentWeights.continuousAssessment;
  } else if (hasLegacyWeights) {
    if (!Object.prototype.hasOwnProperty.call(root, 'examWeight') || !Object.prototype.hasOwnProperty.call(root, 'continuousAssessmentWeight')) throw new Error('La configuración de porcentajes debe incluir “examWeight” y “continuousAssessmentWeight”.');
    examWeight = root.examWeight;
    continuousAssessmentWeight = root.continuousAssessmentWeight;
  }
  const finalReportGradeMode = root.finalReportGradeMode ?? DEFAULT_CENTER_CONFIGURATION.finalReportGradeMode;
  const notEvaluatedValue = Object.prototype.hasOwnProperty.call(root, 'notEvaluated') ? root.notEvaluated : Object.prototype.hasOwnProperty.call(root, 'notEvaluatedValue') ? root.notEvaluatedValue : DEFAULT_CENTER_CONFIGURATION.notEvaluatedValue;
  const gradesProvided = Object.prototype.hasOwnProperty.call(root, 'grades');
  const explanationsProvided = Object.prototype.hasOwnProperty.call(root, 'gradesExplanation');
  if ((gradesProvided && !Array.isArray(root.grades)) || (explanationsProvided && !object(root.gradesExplanation))) throw new Error('La configuración de notas con letras no es válida.');
  const hasLetterGrades = Boolean(gradesProvided && explanationsProvided && (root.grades as unknown[]).length && Object.keys(root.gradesExplanation as Record<string, unknown>).length);
  const grades = hasLetterGrades ? root.grades : [];
  const gradesExplanation = hasLetterGrades ? root.gradesExplanation : undefined;
  if (typeof examWeight !== 'number' || !Number.isFinite(examWeight) || typeof continuousAssessmentWeight !== 'number' || !Number.isFinite(continuousAssessmentWeight) || typeof notEvaluatedValue !== 'string') throw new Error('La configuración del centro no es válida.');
  return normalizeCenterConfiguration({ examWeight, continuousAssessmentWeight, finalReportGradeMode: finalReportGradeMode as CenterConfiguration['finalReportGradeMode'], notEvaluatedValue, grades: grades as CenterConfiguration['grades'], gradesExplanation: gradesExplanation as Record<string, string> | undefined, hasAssessmentWeights, hasLetterGrades });
}

function parseCenterCsv(content: string): CenterCourseData[] {
  const rows = csvRows(content).filter(row => row.some(cell => cell.trim())); if (!rows.length) return [];
  const headers = rows[0].map(normalize);
  const courseIndex = headers.findIndex(header => ['curso', 'curs', 'course', 'maila'].includes(header));
  const subjectIndex = headers.findIndex(header => ['asignaturas', 'assignatures', 'subjects', 'asignatura', 'assignatura', 'subject', 'irakasgaiak', 'materias'].includes(header));
  const studentIndex = headers.findIndex(header => ['alumnos', 'alumnes', 'students', 'alumno', 'alumne', 'student', 'ikasleak'].includes(header));
  if (courseIndex < 0 || subjectIndex < 0 || studentIndex < 0) throw new Error('El CSV debe incluir “Curso”, “Asignaturas” y “Alumnos”.');
  const grouped = new Map<string, CenterCourseData>();
  for (const row of rows.slice(1)) {
    const name = (row[courseIndex] ?? '').trim(); if (!name) continue;
    const key = name.toLocaleLowerCase(); const course = grouped.get(key) ?? { name, subjects: [], students: [] };
    course.subjects = unique([...course.subjects, ...splitList(row[subjectIndex] ?? '')]);
    course.students.push(...splitList(row[studentIndex] ?? ''));
    grouped.set(key, course);
  }
  return [...grouped.values()];
}

function textEntry(value: unknown) {
  if (typeof value === 'string') return value;
  if (object(value) && typeof (value.name ?? value.nombre ?? value.nom ?? value.fullName) === 'string') return (value.name ?? value.nombre ?? value.nom ?? value.fullName) as string;
  throw new Error('Hay un elemento sin nombre válido.');
}
function splitList(value: string) { return value.split('|').map(item => item.trim()).filter(Boolean); }

function json(content: string): unknown { try { return JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('El archivo JSON no es válido.'); } }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function normalize(value: string) { return value.trim().toLocaleLowerCase('es'); }
function unique(values: string[]) { return [...new Map(values.map(value => value.trim()).filter(Boolean).map(value => [value.toLocaleLowerCase(), value])).values()]; }
function message(error: unknown) { return error instanceof Error ? error.message : 'No se ha podido interpretar el archivo.'; }

function csvRows(raw: string): string[][] {
  const content = raw.replace(/^\uFEFF/, ''); const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = ([',', ';', '\t'] as Array<',' | ';' | '\t'>).sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') { if (quoted && content[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && content[index + 1] === '\n') index++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

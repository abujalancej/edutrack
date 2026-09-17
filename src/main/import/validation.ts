import { isCourseLevel, normalizeTrimester, TRIMESTER_LABELS } from '../../shared/catalogs/catalogs';
import type { FullSeguimentExport } from '../../shared/types/models';

export type ValidationResult = { ok: true; data: FullSeguimentExport } | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateImport(value: unknown): ValidationResult {
  if (!object(value)) return invalid('El archivo no contiene un objeto JSON válido.');
  if (value.format !== 'full-seguiment') return invalid('El formato del archivo no es compatible con EduTrack.');
  if (value.version !== 1 && value.version !== 2) return invalid('La versión del archivo no es compatible.');
  if (!object(value.course) || !isCourseLevel(value.course.level)) return invalid('El curso no pertenece al catálogo permitido.');
  if (typeof value.course.name !== 'string' || !value.course.name.trim()) return invalid('El nombre del curso no es válido.');
  if (!object(value.trimester)) return invalid('El trimestre no pertenece al catálogo permitido.');
  const trimester = normalizeTrimester(value.trimester.id);
  if (!trimester) return invalid('El trimestre no pertenece al catálogo permitido.');
  if (value.trimester.name !== TRIMESTER_LABELS[trimester]) return invalid('El nombre del trimestre no coincide con su identificador.');
  if (!object(value.subject) || typeof value.subject.name !== 'string' || !value.subject.name.trim()) return invalid('La asignatura no es válida para este curso.');
  if (value.subject.gradeMode !== undefined && value.subject.gradeMode !== 'NUMERIC' && value.subject.gradeMode !== 'LETTER') return invalid('El tipo de nota no es válido.');
  if (value.subject.isElective !== undefined && typeof value.subject.isElective !== 'boolean') return invalid('El indicador de asignatura optativa no es válido.');
  if (!object(value.teacher) || !text(value.teacher.firstName) || !text(value.teacher.lastName)) return invalid('Faltan los datos del profesor.');
  if (value.teacher.sex !== undefined && value.teacher.sex !== 'MALE' && value.teacher.sex !== 'FEMALE') return invalid('El sexo del profesor no es válido.');
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) return invalid('La fecha de exportación no es válida.');
  if (!Array.isArray(value.columns)) return invalid('La lista de columnas no es válida.');
  const columnIds = new Set<string>();
  for (const column of value.columns) {
    if (!object(column) || !text(column.id) || !text(column.name) || columnIds.has(column.id)) return invalid('Hay una columna inválida o duplicada.');
    if (column.kind !== undefined && column.kind !== 'EXAM' && column.kind !== 'CONTINUOUS_ASSESSMENT') return invalid('Hay una columna con un tipo de evaluación inválido.');
    if (column.assessmentDate !== undefined && (typeof column.assessmentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(column.assessmentDate))) return invalid('Hay una columna con una fecha inválida.');
    columnIds.add(column.id);
  }
  if (!Array.isArray(value.students) || value.students.length === 0) return invalid('El archivo no contiene alumnos.');
  const studentNames = new Set<string>();
  for (const student of value.students) {
    if (!object(student) || !text(student.name) || !object(student.values)) return invalid('Hay un alumno inválido.');
    if (value.version === 2) {
      const name = student.name.trim().toLocaleLowerCase();
      if (studentNames.has(name)) return invalid('Hay nombres de alumnos duplicados en el archivo v2.');
      studentNames.add(name);
    }
    if (student.enabled !== undefined && typeof student.enabled !== 'boolean') return invalid('El estado del alumno no es válido.');
    if (value.version === 2) {
      if (typeof student.enrolled !== 'boolean' || !object(student.applicability)) return invalid('Falta el estado de pertenencia o aplicabilidad del alumno.');
      if (Object.keys(student.applicability).length !== columnIds.size) return invalid('La aplicabilidad no cubre todas las evaluaciones.');
      for (const [key, status] of Object.entries(student.applicability)) {
        if (!columnIds.has(key) || (status !== 'APPLICABLE' && status !== 'NOT_APPLICABLE')) return invalid('Estado de aplicabilidad no válido.');
      }
    }
    for (const [key, cell] of Object.entries(student.values)) {
      if (!columnIds.has(key) || typeof cell !== 'string') return invalid('Hay un valor de celda inválido.');
    }
    if (student.observations !== undefined) {
      if (!object(student.observations)) return invalid('Hay observaciones inválidas.');
      for (const [key, cell] of Object.entries(student.observations)) {
        if (!columnIds.has(key) || typeof cell !== 'string') return invalid('Hay una observación inválida.');
      }
    }
  }
  const data = value as unknown as FullSeguimentExport;
  return { ok: true, data: { ...data, trimester: { ...data.trimester, id: trimester } } };
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const invalid = (error: string): ValidationResult => ({ ok: false, error });

export function compareStudentNames(officialNames: string[], fileNames: string[]) {
  const counts = (names: string[]) => names.reduce<Map<string, number>>((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map());
  const official = counts(officialNames);
  const imported = counts(fileNames);
  const missingInFile: string[] = [];
  const extraInFile: string[] = [];
  for (const [name, count] of official) for (let i = 0; i < count - (imported.get(name) ?? 0); i++) missingInFile.push(name);
  for (const [name, count] of imported) for (let i = 0; i < count - (official.get(name) ?? 0); i++) extraInFile.push(name);
  return { missingInFile, extraInFile, matches: missingInFile.length === 0 && extraInFile.length === 0 };
}

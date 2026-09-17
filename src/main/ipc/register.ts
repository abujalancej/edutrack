import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isCourseLevel, normalizeTrimester } from '../../shared/catalogs/catalogs';
import { isCompleteGradeValue } from '../../shared/grades/grades';
import type { FullSeguimentExport, ImportAnalysis, WorksheetFileAnalysis } from '../../shared/types/models';
import { CenterRosterChangeError, type AppDatabase, type RosterAssignment } from '../database/database';
import { buildExport, suggestedFilename } from '../export/export-service';
import { pdfFolderDialogLabels, writeStudentReportPdfs } from '../export/student-report-pdf-service';
import { issueTrackingReport } from '../export/tracking-report-issue-service';
import { deliveryRosterError } from '../import/delivery-roster';
import { compareStudentNames, validateImport } from '../import/validation';
import { parseRosterFile } from '../import/roster-parser';
import { parseCenterFile, parseCoursesFile, parseSubjectsFile } from '../import/catalog-parser';

export function registerIpc(db: AppDatabase) {
  let pendingCenterUpdate: { token: string; courses: Array<{ name: string; subjects: string[]; students: string[] }>; centerConfiguration: ReturnType<AppDatabase['getCenterConfiguration']>; revision: string } | null = null;
  ipcMain.handle('state:get', () => db.getInitialState());
  ipcMain.handle('language:save', (_e, language) => db.saveLanguage(language));
  ipcMain.handle('profile:save', (_e, profile) => {
    if (!profile || (profile.sex !== 'MALE' && profile.sex !== 'FEMALE')) throw new Error('PROFILE_SEX_REQUIRED');
    return db.saveProfile(profile);
  });
  ipcMain.handle('configuration:center-import', async () => {
    if (db.listCourses().length || db.listStudents().length || db.listSubjects().length || db.listWorksheets().length || db.listTrackingReports().length) return { ok: false, code: 'CENTER_PREVIEW_REQUIRED', error: 'Los datos existentes requieren una vista previa antes de actualizarse.' };
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Datos del centro', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0]; const parsed = parseCenterFile(await readFile(path, 'utf8'), extname(path));
      if (!parsed.ok) return parsed;
      return { ok: true, ...db.replaceCenterData(parsed.courses, parsed.centerConfiguration) };
    } catch (error) {
      if (error instanceof CenterRosterChangeError) return { ok: false, code: 'CENTER_ROSTER_CHANGED', rosterChanges: error.changes, error: error.message };
      return { ok: false, error: error instanceof Error ? error.message : 'No se han podido cargar los datos del centro.' };
    }
  });
  ipcMain.handle('configuration:center-analyze', async () => {
    pendingCenterUpdate = null;
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Datos del centro', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0];
      const parsed = parseCenterFile(await readFile(path, 'utf8'), extname(path));
      if (!parsed.ok) return parsed;
      const preview = db.analyzeCenterUpdate(parsed.courses, parsed.centerConfiguration);
      const token = randomUUID();
      pendingCenterUpdate = { token, courses: parsed.courses, centerConfiguration: parsed.centerConfiguration, revision: preview.revision };
      return { ok: true, token, preview };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido analizar el archivo.' }; }
  });
  ipcMain.handle('configuration:center-apply', (_e, token: string, effectiveDate: string | null, assignments: RosterAssignment[]) => {
    if (!pendingCenterUpdate || token !== pendingCenterUpdate.token) return { ok: false, error: 'La vista previa ya no es válida. Vuelve a cargar el archivo.' };
    if (!Array.isArray(assignments) || assignments.some(item => !item || typeof item.courseId !== 'string' || typeof item.incomingName !== 'string' || (item.studentId !== null && !Number.isInteger(item.studentId)))) return { ok: false, error: 'Las correspondencias del alumnado no son válidas.' };
    try {
      const result = db.applyCenterUpdate(pendingCenterUpdate.courses, pendingCenterUpdate.centerConfiguration, effectiveDate, assignments, pendingCenterUpdate.revision);
      pendingCenterUpdate = null;
      return { ok: true, ...result };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido actualizar el centro.' }; }
  });
  ipcMain.handle('configuration:center-cancel', () => { pendingCenterUpdate = null; });
  ipcMain.handle('configuration:center-clear', () => db.clearCenterData());
  ipcMain.handle('configuration:courses-import', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Catálogo de cursos', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0]; const parsed = parseCoursesFile(await readFile(path, 'utf8'), extname(path));
      if (!parsed.ok) return parsed;
      return { ok: true, courses: db.replaceCourses(parsed.names) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se han podido cargar los cursos.' }; }
  });
  ipcMain.handle('configuration:subjects-import', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Catálogo de asignaturas', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0]; const parsed = parseSubjectsFile(await readFile(path, 'utf8'), extname(path));
      if (!parsed.ok) return parsed;
      return { ok: true, subjects: db.replaceSubjectCatalog(parsed.entries) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se han podido cargar las asignaturas.' }; }
  });
  ipcMain.handle('configuration:logo-choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Logo del centro', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0]; const extension = extname(path).toLowerCase(); const data = await readFile(path);
      if (data.byteLength > 5 * 1024 * 1024) return { ok: false, error: 'El logo no puede superar 5 MB.' };
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      const logo = `data:${mime};base64,${data.toString('base64')}`; db.saveSchoolLogo(logo); return { ok: true, logo };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido cargar el logo.' }; }
  });
  ipcMain.handle('configuration:logo-remove', () => db.saveSchoolLogo(''));
  ipcMain.handle('student:add', (_e, course, name) => {
    if (!isCourseLevel(course) || !db.hasCourse(course)) throw new Error('Curso no válido.');
    return db.addStudent(course, name);
  });
  ipcMain.handle('student:update', (_e, id, name) => db.updateStudent(id, name));
  ipcMain.handle('student:delete', (_e, id) => db.deleteStudent(id));
  ipcMain.handle('student:reorder', (_e, course, ids) => {
    if (!isCourseLevel(course) || !db.hasCourse(course) || !Array.isArray(ids)) throw new Error('Orden de alumnos no válido.');
    return db.reorderStudents(course, ids);
  });
  ipcMain.handle('roster:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Listas de alumnos', extensions: ['csv', 'json'] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('roster:analyze', async (_e, path: string) => {
    try {
      const extension = extname(path).toLowerCase();
      if (!['.csv', '.json'].includes(extension)) return { path, ok: false, error: 'El archivo debe tener extensión .csv o .json.' };
      const result = parseRosterFile(await readFile(path, 'utf8'), extension);
      return result.ok ? { path, ok: true, names: result.names } : { path, ok: false, error: result.error };
    } catch (error) { return { path, ok: false, error: error instanceof Error ? error.message : 'No se ha podido leer el archivo.' }; }
  });
  ipcMain.handle('roster:replace', (_e, course, names) => {
    if (!isCourseLevel(course) || !db.hasCourse(course) || !Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Lista de alumnos no válida.');
    return db.replaceCourseRoster(course, names);
  });
  ipcMain.handle('worksheet:create', (_e, input) => {
    const trimester = normalizeTrimester(input.trimester);
    if (!isCourseLevel(input.courseLevel) || !trimester || !['NUMERIC', 'LETTER'].includes(input.gradeMode) || typeof input.isElective !== 'boolean' || !db.hasCourse(input.courseLevel) || !db.hasSubject(input.courseLevel, input.subject)) throw new Error('INVALID_WORKSHEET_SELECTION');
    return db.createWorksheet({ ...input, trimester });
  });
  ipcMain.handle('worksheet:copy', (_e, worksheetId, targetTrimester) => {
    const trimester = normalizeTrimester(targetTrimester);
    if (!Number.isInteger(worksheetId) || worksheetId <= 0 || !trimester) throw new Error('INVALID_WORKSHEET_COPY');
    return db.copyWorksheet(worksheetId, trimester);
  });
  ipcMain.handle('worksheet:elective-students', (_e, worksheetId, enabledStudentIds) => {
    if (!Number.isInteger(worksheetId) || worksheetId <= 0 || !Array.isArray(enabledStudentIds)) throw new Error('Selección de alumnado no válida.');
    return db.configureElectiveStudents(worksheetId, enabledStudentIds);
  });
  ipcMain.handle('worksheet:delete', (_e, id) => db.deleteWorksheet(id));
  ipcMain.handle('worksheet:get', (_e, id) => db.getWorksheet(id));
  ipcMain.handle('assessment:add', (_e, input) => db.addAssessment(input.worksheetId, input.kind, input.name, input.assessmentDate));
  ipcMain.handle('column:rename', (_e, id, name) => db.renameColumn(id, name));
  ipcMain.handle('assessment:update', (_e, id, input) => db.updateAssessment(id, input));
  ipcMain.handle('column:delete', (_e, id) => db.deleteColumn(id));
  ipcMain.handle('cell:save', (_e, worksheetId, studentId, columnId, field, value) => db.saveCell(worksheetId, studentId, columnId, field, value));
  ipcMain.handle('assessment:clear-values', (_e, worksheetId, columnId) => db.clearAssessmentValues(worksheetId, columnId));
  ipcMain.handle('worksheet:export', async (_e, id) => {
    try {
      const data = buildExport(db, id);
      const result = await dialog.showSaveDialog({ defaultPath: suggestedFilename(data), filters: [{ name: 'EduTrack', extensions: ['edutrack'] }] });
      if (result.canceled || !result.filePath) return { ok: false, code: 'CANCELLED' };
      await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'EXPORT_ERROR';
      return { ok: false, code, error: code };
    }
  });
  ipcMain.handle('worksheet:import-choose', async (): Promise<WorksheetFileAnalysis> => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'EduTrack', extensions: ['edutrack'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const path = result.filePaths[0];
    try {
      if (!path.toLowerCase().endsWith('.edutrack')) return { ok: false, error: `${basename(path)} no tiene la extensión .edutrack.` };
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { return { ok: false, error: `${basename(path)} no contiene JSON válido.` }; }
      return analyzeWorksheetFile(db, parsed);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido leer el archivo.' }; }
  });
  ipcMain.handle('worksheet:import-commit', (_e, data: FullSeguimentExport, replace: boolean) => {
    if (typeof replace !== 'boolean') return { ok: false, error: 'La opción de sustitución no es válida.' };
    const analysis = analyzeWorksheetFile(db, data);
    if (!analysis.ok) return analysis;
    if (analysis.duplicate && !replace) return { ok: false, code: 'DUPLICATE_WORKSHEET', error: 'La asignatura ya existe.' };
    try {
      const worksheet = db.restoreWorksheet(analysis.data, replace);
      return { ok: true, replaced: analysis.duplicate, worksheetId: worksheet.id };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'WORKSHEET_IMPORT_ERROR';
      const message = code === 'LETTER_GRADES_NOT_CONFIGURED' ? 'Las notas con letras del archivo no están configuradas en este centro.' : code === 'INVALID_GRADE_VALUE' ? 'El archivo contiene notas no admitidas por la configuración del centro.' : code === 'STUDENT_ROSTER_MISMATCH' ? 'La lista de alumnos no coincide con la lista oficial del curso.' : 'No se ha podido importar la asignatura.';
      return { ok: false, code, error: message };
    }
  });
  ipcMain.handle('import:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'EduTrack', extensions: ['edutrack'] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('import:analyze', async (_e, paths: string[]): Promise<ImportAnalysis[]> => Promise.all(paths.map(async path => {
    try {
      if (!path.toLowerCase().endsWith('.edutrack')) return { path, ok: false, error: `${basename(path)} no tiene la extensión .edutrack.` };
      const raw = await readFile(path, 'utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { path, ok: false, error: `${basename(path)} no contiene JSON válido.` }; }
      const validation = validateImport(parsed);
      if (!validation.ok) return { path, ok: false, error: validation.error };
      if (!db.hasCourse(validation.data.course.level) || db.courseName(validation.data.course.level) !== validation.data.course.name || !db.hasSubject(validation.data.course.level, validation.data.subject.name)) return { path, ok: false, error: 'El curso o la asignatura del archivo no están configurados en este centro.' };
      if (db.isLatestReportIssued(validation.data.course.level, validation.data.trimester.id)) return { path, ok: false, error: 'El informe ya está emitido. Copia el informe antes de importar nuevas entregas.' };
      const comparison = db.compareDelivery(validation.data);
      if (!comparison.matches) return { path, ok: false, error: deliveryRosterError(comparison), ...comparison };
      db.assertDeliveryApplicability(validation.data);
      return { path, ok: true, data: validation.data, duplicate: db.hasImport(validation.data) };
    } catch (error) { return { path, ok: false, error: error instanceof Error ? error.message : 'No se ha podido leer el archivo.' }; }
  })));
  ipcMain.handle('import:commit', (_e, data: FullSeguimentExport) => {
    const valid = validateImport(data);
    if (!valid.ok) return { ok: false, error: valid.error };
    const normalized = valid.data;
    if (!db.hasCourse(normalized.course.level) || db.courseName(normalized.course.level) !== normalized.course.name || !db.hasSubject(normalized.course.level, normalized.subject.name)) return { ok: false, error: 'El curso o la asignatura no están configurados.' };
    if (db.isLatestReportIssued(normalized.course.level, normalized.trimester.id)) return { ok: false, error: 'El informe ya está emitido. Copia el informe antes de importar nuevas entregas.' };
    const comparison = db.compareDelivery(normalized);
    if (!comparison.matches) return { ok: false, error: deliveryRosterError(comparison), missingInFile: comparison.missingInFile, extraInFile: comparison.extraInFile };
    const replaced = db.hasImport(normalized);
    try { db.saveImport(normalized, replaced); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido importar la entrega.' }; }
    return { ok: true, replaced };
  });
  ipcMain.handle('import:get', (_e, id) => db.getImportedWorksheet(id));
  ipcMain.handle('import:blocking', (_e, id, isBlocking) => {
    if (!Number.isInteger(id) || id <= 0 || typeof isBlocking !== 'boolean') throw new Error('Entrega no válida.');
    return db.setImportedWorksheetBlocking(id, isBlocking);
  });
  ipcMain.handle('import:delete', (_e, id) => { if (!Number.isInteger(id) || id <= 0) throw new Error('Entrega no válida.'); db.deleteImportedWorksheet(id); });
  ipcMain.handle('tutor-observation:save', (_e, reportId, studentId, observation) => {
    if (!Number.isInteger(reportId) || reportId <= 0 || !Number.isInteger(studentId) || typeof observation !== 'string' || observation.length > 5000) throw new Error('Observación del tutor no válida.');
    db.saveTutorObservation(reportId, studentId, observation);
  });
  ipcMain.handle('tracking-report:copy', (_e, reportId: number) => {
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('Informe de seguimiento no válido.');
    return db.copyTrackingReport(reportId);
  });
  ipcMain.handle('tracking-reports:export', async (_e, reportId: number) => {
    try {
      if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('INVALID_REPORT_SELECTION');
      const count = await issueTrackingReport(db, reportId, async data => {
        const folderDialog = pdfFolderDialogLabels(data.language);
        const result = await dialog.showOpenDialog({
          title: folderDialog.title,
          buttonLabel: folderDialog.buttonLabel,
          properties: ['openDirectory', 'createDirectory']
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
      }, writeStudentReportPdfs);
      if (count === null) return { ok: false, code: 'CANCELLED' };
      return { ok: true, count };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'EXPORT_ERROR';
      return { ok: false, code, error: code };
    }
  });
  ipcMain.handle('tracking-report:delete', (_e, reportId: number) => {
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('Informe de seguimiento no válido.');
    db.deleteTrackingReport(reportId);
  });
}

function analyzeWorksheetFile(db: AppDatabase, value: unknown): WorksheetFileAnalysis {
  const validation = validateImport(value);
  if (!validation.ok) return validation;
  const data = validation.data;
  if (!db.hasCourse(data.course.level) || db.courseName(data.course.level) !== data.course.name || !db.hasSubject(data.course.level, data.subject.name)) return { ok: false, error: 'El curso o la asignatura del archivo no están configurados en este centro.' };
  const official = db.listStudents(data.course.level).map(student => student.fullName);
  if (!compareStudentNames(official, data.students.map(student => student.name)).matches) return { ok: false, error: 'La lista de alumnos no coincide con la lista oficial del curso.' };
  const gradeMode = data.subject.gradeMode ?? 'NUMERIC';
  const configuration = db.getCenterConfiguration();
  if (gradeMode === 'LETTER' && !configuration.hasLetterGrades) return { ok: false, error: 'Las notas con letras del archivo no están configuradas en este centro.' };
  if (data.students.some(student => Object.values(student.values).some(value => value && !isCompleteGradeValue(value, gradeMode, configuration.grades, configuration.notEvaluatedValue)))) return { ok: false, error: 'El archivo contiene notas no admitidas por la configuración del centro.' };
  const duplicate = db.listWorksheets().some(worksheet => worksheet.courseLevel === data.course.level && worksheet.trimester === data.trimester.id && worksheet.subject === data.subject.name);
  return { ok: true, data, duplicate };
}

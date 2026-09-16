import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { isCourseLevel, normalizeTrimester } from '../../shared/catalogs/catalogs';
import type { CourseLevel } from '../../shared/catalogs/catalogs';
import type { FullSeguimentExport, ImportAnalysis } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';
import { buildExport, suggestedFilename } from '../export/export-service';
import { pdfFolderDialogLabels, writeStudentReportPdfs } from '../export/student-report-pdf-service';
import { buildTrackingReports } from '../export/tracking-report-service';
import { compareStudentNames, validateImport } from '../import/validation';
import { parseRosterFile } from '../import/roster-parser';
import { parseCenterFile, parseCoursesFile, parseSubjectsFile } from '../import/catalog-parser';

export function registerIpc(db: AppDatabase) {
  ipcMain.handle('state:get', () => db.getInitialState());
  ipcMain.handle('language:save', (_e, language) => db.saveLanguage(language));
  ipcMain.handle('profile:save', (_e, profile) => {
    if (!profile || (profile.sex !== 'MALE' && profile.sex !== 'FEMALE')) throw new Error('PROFILE_SEX_REQUIRED');
    return db.saveProfile(profile);
  });
  ipcMain.handle('configuration:center-import', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Datos del centro', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const path = result.filePaths[0]; const parsed = parseCenterFile(await readFile(path, 'utf8'), extname(path));
      if (!parsed.ok) return parsed;
      return { ok: true, ...db.replaceCenterData(parsed.courses, parsed.centerConfiguration) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se han podido cargar los datos del centro.' }; }
  });
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
      const official = db.listStudents(validation.data.course.level).map(student => student.fullName);
      const comparison = compareStudentNames(official, validation.data.students.map(student => student.name));
      if (!comparison.matches) return { path, ok: false, error: 'La lista de alumnos no coincide con la lista oficial del Tutor.', ...comparison };
      return { path, ok: true, data: validation.data, duplicate: db.hasImport(validation.data) };
    } catch (error) { return { path, ok: false, error: error instanceof Error ? error.message : 'No se ha podido leer el archivo.' }; }
  })));
  ipcMain.handle('import:commit', (_e, data: FullSeguimentExport) => {
    const valid = validateImport(data);
    if (!valid.ok) return { ok: false, error: valid.error };
    const normalized = valid.data;
    if (!db.hasCourse(normalized.course.level) || db.courseName(normalized.course.level) !== normalized.course.name || !db.hasSubject(normalized.course.level, normalized.subject.name)) return { ok: false, error: 'El curso o la asignatura no están configurados.' };
    const official = db.listStudents(normalized.course.level as CourseLevel).map(student => student.fullName);
    if (!compareStudentNames(official, normalized.students.map(student => student.name)).matches) return { ok: false, error: 'La lista de alumnos ha cambiado. Revisa de nuevo el archivo.' };
    const replaced = db.hasImport(normalized);
    db.saveImport(normalized, replaced);
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
      const data = buildTrackingReports(db, reportId);
      const folderDialog = pdfFolderDialogLabels(data.language);
      const result = await dialog.showOpenDialog({
        title: folderDialog.title,
        buttonLabel: folderDialog.buttonLabel,
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, code: 'CANCELLED' };
      const count = await writeStudentReportPdfs(data, result.filePaths[0]);
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

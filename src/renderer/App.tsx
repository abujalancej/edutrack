import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TRIMESTERS, type CourseLevel, type Trimester } from '@shared/catalogs/catalogs';
import { DEFAULT_CENTER_CONFIGURATION } from '@shared/center/center-configuration';
import { centerUpdateChoiceKey, prepareCenterUpdateConfirmation } from '@shared/center/center-update-confirmation';
import { isCompleteGradeValue, normalizeGradeValue, numericValueForLetterGrade } from '@shared/grades/grades';
import type { AppLanguage, AppMode, AssessmentKind, FullSeguimentExport, GradeMode, ImportedWorksheetDetail, ImportedWorksheetSummary, ImportAnalysis, InitialState, TeacherSex, TrackingReportSummary, WorksheetDetail, WorksheetSummary } from '@shared/types/models';
import type { FullSeguimentApi } from '@shared/types/ipc';
import { Icon } from './components/Icon';
import { TutorObservationGrid } from './components/TutorObservationGrid';
import { LANGUAGES, LANGUAGE_LABELS, configurationDetailLabels, centerRosterChangeMessage, centerUpdateText, courseUi, reportGenerationLabel, deliveryGeneratedLabel, deliveryRosterInstruction, getActiveLanguage, individualAssessmentUi, localizedError, reportUi, setActiveLanguage, setActiveTeacherSex, subjectUi, tr, trimesterOptionUi, trimesterUi, worksheetStatusUi } from './i18n';
import { subjectMonograms } from './subject-monogram';
import appIcon from './assets/app-icon.png';
import { APP_VERSION } from '@shared/version';
import { backupContentLabels, backupLabels } from '@shared/backup-labels';
import type { BackupPreviewResult } from '@shared/backup';

type View = { page: 'dashboard' | 'settings' | 'help' } | { page: 'sheet'; id: number } | { page: 'imported'; id: number } | { page: 'tutor-report'; reportId: number };
type Notice = { type: 'success' | 'error'; text: string } | null;
type CenterPreviewResult = Extract<Awaited<ReturnType<FullSeguimentApi['analyzeCenterImport']>>, { ok: true }>;
type CenterUpdateAssignment = Parameters<FullSeguimentApi['applyCenterImport']>[2][number];
type CellField = 'grade' | 'observation';
type GridSelection = { start: { row: number; column: number }; end: { row: number; column: number } };
const GRID_FIELDS: CellField[] = ['grade', 'observation'];
const importedGradeTone = (value: string, mode: GradeMode, grades: InitialState['centerConfiguration']['grades'], notEvaluatedValue: string) => {
  const normalized = normalizeGradeValue(value);
  if (!normalized) return 'missing';
  const numericGrade = mode === 'LETTER' ? numericValueForLetterGrade(normalized, grades) : Number(value.replace(',', '.'));
  if (normalized === normalizeGradeValue(notEvaluatedValue)) return 'neutral';
  return numericGrade === undefined || numericGrade < 5 ? 'fail' : 'pass';
};
const emptyState: InitialState = { profile: { firstName: '', lastName: '', sex: 'MALE' }, language: 'es', schoolLogo: '', centerConfiguration: DEFAULT_CENTER_CONFIGURATION, courses: [], subjects: [], students: [], worksheets: [], imports: [], reportSubjectExclusions: [], trackingReports: [], tutorObservations: {} };
const courseName = (state: InitialState, id: string) => state.courses.find(course => course.id === id)?.name ?? courseUi(id);
const courseSubjects = (state: InitialState, id: string) => state.subjects.filter(subject => subject.courseId === id).sort((a, b) => a.sortOrder - b.sortOrder).map(subject => subject.name);
const configuredSheetName = (state: InitialState, courseId: string, trimester: Trimester, subject: string) => `${courseName(state, courseId)} · ${trimesterUi(trimester)} · ${subjectUi(subject)}`;
const trackingProgress = (state: InitialState, course: CourseLevel, deliveries: ImportedWorksheetSummary[], reportId?: number) => {
  const subjects = courseSubjects(state, course);
  const deliveryFor = (subject: string) => deliveries.find(delivery => delivery.subject === subject);
  const subjectExcluded = (subject: string) => deliveryFor(subject)?.isBlocking === false || (reportId !== undefined && state.reportSubjectExclusions.some(exclusion => exclusion.reportId === reportId && exclusion.subject === subject));
  const blockingSubjects = subjects.filter(subject => !subjectExcluded(subject));
  const receivedCount = blockingSubjects.filter(subject => Boolean(deliveryFor(subject) && !deliveryFor(subject)?.isStale)).length;
  return { total: blockingSubjects.length, receivedCount, complete: receivedCount > 0 && receivedCount === blockingSubjects.length && !deliveries.some(delivery => delivery.isStale) };
};
const tutorCommentProgress = (state: InitialState, reportId: number, course: CourseLevel) => {
  const students = state.students.filter(student => student.courseLevel === course);
  const count = students.filter(student => Boolean(state.tutorObservations[`${reportId}:${student.id}`]?.trim())).length;
  return { total: students.length, count };
};

export default function App() {
  const [mode, setMode] = useState<AppMode | null>(null);
  const [view, setView] = useState<View>({ page: 'dashboard' });
  const [state, setState] = useState<InitialState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [language, setLanguage] = useState<AppLanguage>('es');

  const refresh = useCallback(async () => { const next = await window.fullSeguiment.getInitialState(); setActiveLanguage(next.language); setLanguage(next.language); setActiveTeacherSex(next.profile.sex); setState(next); }, []);
  const updateProfile = useCallback((profile: InitialState['profile']) => { const normalized = { ...profile, sex: profile.sex === 'FEMALE' ? 'FEMALE' as const : 'MALE' as const }; setActiveTeacherSex(normalized.sex); setState(current => ({ ...current, profile: normalized })); }, []);
  useEffect(() => { void window.fullSeguiment.getInitialState().then(next => { setState(next); setLanguage(next.language); setActiveLanguage(next.language); setActiveTeacherSex(next.profile.sex); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!loading && view.page === 'dashboard') void window.fullSeguiment.getInitialState().then(setState); }, [loading, mode, view.page]);
  const notify = useCallback((next: Notice) => { setNotice(next); window.setTimeout(() => setNotice(null), 4200); }, []);
  const changeMode = (next: AppMode) => { setMode(next); setView({ page: 'dashboard' }); };
  const changeLanguage = (next: AppLanguage) => { setActiveLanguage(next); setLanguage(next); setState(current => ({ ...current, language: next })); void window.fullSeguiment.saveLanguage(next); };

  if (loading) return <div className="splash"><Logo /><div className="spinner" /><p>{tr('loading')}</p></div>;
  if (!mode) return <Welcome onChoose={changeMode} language={language} onLanguage={changeLanguage} />;

  return <div className="app-shell">
    <Sidebar mode={mode} view={view} state={state} onNavigate={setView} onMode={changeMode} language={language} onLanguage={changeLanguage} />
    <main className="main-content">
      {view.page === 'dashboard' && mode === 'teacher' && <TeacherDashboard state={state} refresh={refresh} navigate={setView} notify={notify} />}
      {view.page === 'dashboard' && mode === 'tutor' && <TutorDashboard state={state} navigate={setView} refresh={refresh} notify={notify} />}
      {view.page === 'tutor-report' && mode === 'tutor' && <TutorReportPage state={state} reportId={view.reportId} navigate={setView} refresh={refresh} notify={notify} />}
      {view.page === 'settings' && <Settings state={state} refresh={refresh} notify={notify} onProfileChange={updateProfile} />}
      {view.page === 'help' && <HelpPage />}
      {view.page === 'sheet' && <WorksheetPage id={view.id} navigate={setView} refresh={refresh} notify={notify} courses={state.courses} profile={state.profile} centerConfiguration={state.centerConfiguration} />}
      {view.page === 'imported' && <ImportedPage id={view.id} navigate={setView} state={state} />}
    </main>
    {notice && <div className={`toast ${notice.type}`}><Icon name={notice.type === 'success' ? 'check' : 'x'} />{notice.text}</div>}
  </div>;
}

function Logo() { return <img className="logo-mark app-logo" src={appIcon} alt="" aria-hidden="true" />; }

function LanguageSelect({ value, onChange, compact = false }: { value: AppLanguage; onChange: (language: AppLanguage) => void; compact?: boolean }) { return <label className={`language-select ${compact ? 'compact-language' : ''}`}><span>{tr('language')}</span><select value={value} onChange={e => onChange(e.target.value as AppLanguage)}>{LANGUAGES.map(item => <option value={item} key={item}>{LANGUAGE_LABELS[item]}</option>)}</select></label>; }

function Welcome({ onChoose, language, onLanguage }: { onChoose: (mode: AppMode) => void; language: AppLanguage; onLanguage: (language: AppLanguage) => void }) {
  return <div className="welcome">
    <header className="welcome-topbar"><div className="welcome-brand"><Logo /><div><h1>EduTrack</h1><p>{tr('tagline')}</p></div></div><div className="welcome-language"><LanguageSelect value={language} onChange={onLanguage} compact /></div></header>
    <section className="welcome-card welcome-card-simple"><h2>{tr('chooseRole')}</h2>
      <div className="role-grid">
        <button className="role-card teacher" onClick={() => onChoose('teacher')}><span className="role-icon"><Icon name="teacher" size={32} /></span><span className="role-copy"><strong>{tr('teacher')}</strong><small>{tr('teacherHelp')}</small></span><span className="role-arrow" aria-hidden="true">→</span></button>
        <button className="role-card tutor" onClick={() => onChoose('tutor')}><span className="role-icon"><Icon name="tutor" size={32} /></span><span className="role-copy"><strong>{tr('tutor')}</strong><small>{tr('tutorHelp')}</small></span><span className="role-arrow" aria-hidden="true">→</span></button>
      </div>
    </section>
  </div>;
}

function Sidebar({ mode, view, state, onNavigate, onMode, language, onLanguage }: { mode: AppMode; view: View; state: InitialState; onNavigate: (v: View) => void; onMode: (m: AppMode) => void; language: AppLanguage; onLanguage: (language: AppLanguage) => void }) {
  const dashboardLabel = mode === 'teacher' ? tr('subjectsMenu') : tr('trackingReportsMenu');
  const dataComplete = Boolean(state.courses.length && state.subjects.length && state.students.length && state.schoolLogo && state.profile.firstName.trim() && state.profile.lastName.trim());
  return <aside className="sidebar">
    <div className="brand"><Logo /><div><strong>EduTrack</strong><small>{tr('academicManagement')}</small></div></div>
    <div className="mode-switch" role="group" aria-label={tr('chooseRole')}>
      <button title={tr('teacher')} className={mode === 'teacher' ? 'active' : ''} onClick={() => onMode('teacher')}><Icon name="teacher" /> <span>{tr('teacher')}</span></button>
      <button title={tr('tutor')} className={mode === 'tutor' ? 'active' : ''} onClick={() => onMode('tutor')}><Icon name="tutor" /> <span>{tr('tutor')}</span></button>
    </div>
    <nav>
      <span className="nav-caption">{mode === 'teacher' ? tr('teacherSpace') : tr('tutorSpace')}</span>
      <button title={dashboardLabel} className={view.page === 'dashboard' || view.page === 'sheet' || view.page === 'tutor-report' || view.page === 'imported' ? 'active' : ''} onClick={() => onNavigate({ page: 'dashboard' })}><Icon name={mode === 'teacher' ? 'book' : 'report'} /> <span>{dashboardLabel}</span></button>
    </nav>
    <div className="sidebar-foot"><nav className="sidebar-common"><label className="sidebar-language-row"><Icon name="language" /><span>{tr('language')}</span><select value={language} aria-label={tr('language')} onChange={event => onLanguage(event.target.value as AppLanguage)}>{LANGUAGES.map(item => <option value={item} key={item}>{LANGUAGE_LABELS[item]}</option>)}</select></label><button title={`${tr('dataMenu')}: ${dataComplete ? tr('dataComplete') : tr('dataIncomplete')}`} className={view.page === 'settings' ? 'active' : ''} onClick={() => onNavigate({ page: 'settings' })}><Icon name="database" /> <span>{tr('dataMenu')}</span><i className={`sidebar-data-status ${dataComplete ? 'complete' : 'incomplete'}`} aria-label={dataComplete ? tr('dataComplete') : tr('dataIncomplete')}><Icon name={dataComplete ? 'check' : 'x'} size={14} /></i></button><button title={tr('help')} className={view.page === 'help' ? 'active' : ''} onClick={() => onNavigate({ page: 'help' })}><Icon name="sheet" /> <span>{tr('help')}</span></button></nav><small className="app-credit">EduTrack v{APP_VERSION} · <a href="https://github.com/abujalancej/edutrack" target="_blank" rel="noreferrer">abujalancej</a></small></div>
  </aside>;
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function TeacherDashboard({ state, refresh, navigate, notify }: { state: InitialState; refresh: () => Promise<void>; navigate: (v: View) => void; notify: (n: Notice) => void }) {
  const [creating, setCreating] = useState(false);
  const [copyingSheet, setCopyingSheet] = useState<WorksheetSummary | null>(null);
  const [sheetToDelete, setSheetToDelete] = useState<WorksheetSummary | null>(null);
  const [worksheetToImport, setWorksheetToImport] = useState<FullSeguimentExport | null>(null);
  const catalogReady = state.courses.length > 0 && state.subjects.length > 0;
  const completedSheets = state.worksheets.filter(sheet => sheet.isComplete).length;
  const grouped = useMemo(() => state.courses.map(course => ({ course, trimesters: TRIMESTERS.map(trimester => ({ trimester, sheets: state.worksheets.filter(w => w.courseLevel === course.id && w.trimester === trimester) })).filter(x => x.sheets.length) })).filter(x => x.trimesters.length), [state.courses, state.worksheets]);
  const deleteSheet = async (sheet: WorksheetSummary) => {
    await window.fullSeguiment.deleteWorksheet(sheet.id); await refresh(); notify({ type: 'success', text: tr('sheetDeleted') });
  };
  const copySheet = async (trimester: Trimester) => {
    if (!copyingSheet) return;
    const copy = await window.fullSeguiment.copyWorksheet(copyingSheet.id, trimester);
    await refresh(); setCopyingSheet(null); notify({ type: 'success', text: tr('copySheetCreated') }); navigate({ page: 'sheet', id: copy.id });
  };
  const exportSheet = async (sheet: WorksheetSummary) => {
    const result = await window.fullSeguiment.exportWorksheet(sheet.id);
    if (result.ok) notify({ type: 'success', text: tr('exported') });
    else if (result.code === 'PROFILE_REQUIRED') { notify({ type: 'error', text: tr('profileNeeded') }); navigate({ page: 'settings' }); }
    else if (result.code === 'STUDENTS_REQUIRED') notify({ type: 'error', text: tr('studentsNeeded') });
    else if (result.code === 'INCOMPLETE_WORKSHEET') notify({ type: 'error', text: tr('worksheetIncomplete') });
    else if (result.code === 'AMBIGUOUS_STUDENT_NAMES') notify({ type: 'error', text: worksheetStatusUi('ambiguousNames') });
  };
  const restoreWorksheet = async (data: FullSeguimentExport, replace: boolean) => {
    const result = await window.fullSeguiment.commitWorksheetImport(data, replace);
    if (!result.ok || !result.worksheetId) { notify({ type: 'error', text: localizedError(result.error, 'worksheetImportError') }); return false; }
    await refresh(); notify({ type: 'success', text: tr(replace ? 'worksheetReplaced' : 'worksheetImported', { trimester: trimesterUi(data.trimester.id) }) }); navigate({ page: 'sheet', id: result.worksheetId }); return true;
  };
  const chooseWorksheetImport = async () => {
    const result = await window.fullSeguiment.chooseWorksheetImport();
    if (!result.ok) { if (!result.cancelled) notify({ type: 'error', text: localizedError(result.error, 'worksheetImportError') }); return; }
    if (result.duplicate) setWorksheetToImport(result.data);
    else await restoreWorksheet(result.data, false);
  };
  return <>
    <PageHeader eyebrow={tr('teacherSpace')} title={tr('mySheets')} subtitle={tr('mySheetsHelp')} action={<div className="header-actions"><button className="secondary header-icon-action" title={catalogReady ? tr('importWorksheet') : tr('configureCenterHelp')} aria-label={tr('importWorksheet')} disabled={!catalogReady} onClick={() => void chooseWorksheetImport()}><Icon name="upload" /></button><button className="primary header-icon-action" title={catalogReady ? tr('newSheet') : tr('configureCenterHelp')} aria-label={tr('newSheet')} disabled={!catalogReady} onClick={() => setCreating(true)}><Icon name="plus" /></button></div>} />
    <section className="teacher-summary" aria-label={tr('summary')}><div className="teacher-summary-items"><article><span><Icon name="sheet" /></span><div><strong>{state.worksheets.length}</strong><small>{tr('sheetsCreated')}</small></div></article><article className="ready"><span><Icon name="download" /></span><div><strong>{completedSheets}</strong><small>{tr('readyToExport')}</small></div></article></div></section>
    {grouped.length === 0 ? <Empty icon="sheet" title={tr('noSheets')} text={catalogReady ? tr('noSheetsHelp') : tr('configureCenterHelp')} /> :
      <div className="course-list">{grouped.map(group => { const courseSheets = group.trimesters.flatMap(item => item.sheets); const completed = courseSheets.filter(sheet => sheet.isComplete).length; const monograms = subjectMonograms(courseSheets.map(sheet => sheet.subject)); return <section className="course-group" key={group.course.id}><div className="course-title"><span>{group.course.name}</span><small className={completed === courseSheets.length ? 'all-complete' : ''}>{completed}/{courseSheets.length} {tr('complete').toLocaleLowerCase()}</small></div>{group.trimesters.map(t => <div className="trimester-block" key={t.trimester}><h3>{trimesterUi(t.trimester)}</h3><div className="sheet-cards subject-rows">{t.sheets.map(sheet => { const changes = sheet.changeSummary; return <article className={`sheet-card dashboard-item-card ${sheet.isComplete ? 'sheet-complete' : ''}`} key={sheet.id}><button className="sheet-open-button" onClick={() => navigate({ page: 'sheet', id: sheet.id })}><span className="subject-monogram">{monograms.get(sheet.subject)}</span><span className="sheet-card-copy"><strong>{subjectUi(sheet.subject)}{sheet.isElective && <i className="subject-elective-badge">{tr('elective')}</i>}</strong><small>{tr('updated')} {formatRelative(sheet.updatedAt)}</small>{changes && <span className="worksheet-change-warnings">{changes.addedStudents.length > 0 && <b>{tr('newStudentsWarning', { count: changes.addedStudents.length })}</b>}{changes.removedStudents.length > 0 && <b>{tr('removedStudentsWarning', { count: changes.removedStudents.length })}</b>}{changes.addedAssessments.length > 0 && <b>{tr('newAssessmentsWarning', { count: changes.addedAssessments.length })}</b>}</span>}</span><span className="assessment-counts"><b>{tr('examCount', { count: sheet.examCount })}</b><b>{tr('continuousCount', { count: sheet.continuousAssessmentCount })}</b></span><span className={`subject-completion ${sheet.isComplete ? 'complete' : 'incomplete'}`}>{sheet.isComplete && <Icon name="check" size={14} />}{sheet.isComplete ? tr('complete') : tr('incomplete')}</span></button><div className="report-card-actions"><button className="icon-button sheet-card-icon-action sheet-export-button" title={sheet.isComplete ? tr('export') : tr('worksheetIncomplete')} aria-label={`${tr('export')}: ${subjectUi(sheet.subject)}`} disabled={!sheet.isComplete} onClick={() => void exportSheet(sheet)}><Icon name="download" /></button><button className="icon-button sheet-card-icon-action" title={tr('copySheet')} aria-label={`${tr('copySheet')}: ${subjectUi(sheet.subject)}`} onClick={() => setCopyingSheet(sheet)}><Icon name="copy" /></button><button className="icon-button danger sheet-card-icon-action sheet-delete-button" title={tr('delete')} aria-label={`${tr('delete')}: ${subjectUi(sheet.subject)}`} onClick={() => setSheetToDelete(sheet)}><Icon name="trash" /></button></div></article>; })}</div></div>)}</section>; })}</div>}
    {creating && <NewWorksheetModal state={state} close={() => setCreating(false)} refresh={refresh} navigate={navigate} />}
    {copyingSheet && <CopyWorksheetModal subject={copyingSheet.subject} sourceTrimester={copyingSheet.trimester} existingTrimesters={state.worksheets.filter(item => item.courseLevel === copyingSheet.courseLevel && item.subject === copyingSheet.subject).map(item => item.trimester)} close={() => setCopyingSheet(null)} onSave={copySheet} />}
    {sheetToDelete && <ConfirmDeleteModal title={tr('deleteSheetTitle')} question={tr('deleteSheetQuestion')} identifier={configuredSheetName(state, sheetToDelete.courseLevel, sheetToDelete.trimester, sheetToDelete.subject)} note={tr('deleteSheetNote')} confirmationText={confirmationWord(sheetToDelete.subject)} confirmationPlaceholder={confirmationWord(sheetToDelete.subject)} close={() => setSheetToDelete(null)} confirm={() => deleteSheet(sheetToDelete)} />}
    {worksheetToImport && <ConfirmDeleteModal title={tr('replaceWorksheetTitle')} question={tr('replaceWorksheetQuestion')} identifier={`${worksheetToImport.course.name} · ${trimesterUi(worksheetToImport.trimester.id)} · ${subjectUi(worksheetToImport.subject.name)}`} note={tr('replaceWorksheetNote')} confirmationText={confirmationWord(worksheetToImport.subject.name)} confirmationPlaceholder={confirmationWord(worksheetToImport.subject.name)} confirmLabel={tr('confirmReplace')} close={() => setWorksheetToImport(null)} confirm={() => restoreWorksheet(worksheetToImport, true)} />}
  </>;
}

function NewWorksheetModal({ state, close, refresh, navigate }: { state: InitialState; close: () => void; refresh: () => Promise<void>; navigate: (v: View) => void }) {
  const [course, setCourse] = useState<CourseLevel>(state.courses[0]?.id ?? ''); const [trimester, setTrimester] = useState<Trimester>('T_1'); const [subject, setSubject] = useState(courseSubjects(state, state.courses[0]?.id ?? '')[0] ?? ''); const [gradeMode, setGradeMode] = useState<GradeMode>(state.centerConfiguration.hasLetterGrades ? state.centerConfiguration.finalReportGradeMode : 'NUMERIC'); const [isElective, setIsElective] = useState(false); const [error, setError] = useState('');
  const create = async () => {
    if (state.worksheets.some(w => w.courseLevel === course && w.trimester === trimester && w.subject === subject)) { setError(tr('duplicateSheet', { sheet: configuredSheetName(state, course, trimester, subject) })); return; }
    try { const sheet = await window.fullSeguiment.createWorksheet({ courseLevel: course, trimester, subject, gradeMode, isElective }); await refresh(); close(); navigate({ page: 'sheet', id: sheet.id }); }
    catch (error) { setError(error instanceof Error && error.message.includes('DUPLICATE_WORKSHEET') ? tr('duplicateSheet', { sheet: configuredSheetName(state, course, trimester, subject) }) : tr('sheetCreationError')); }
  };
  return <Modal title={tr('newSheetTitle')} subtitle={tr('newSheetHelp')} close={close}>
    <label>{tr('course')}<select value={course} onChange={e => { const c = e.target.value as CourseLevel; setCourse(c); setSubject(courseSubjects(state, c)[0] ?? ''); setError(''); }}>{state.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>{tr('trimester')}<select value={trimester} onChange={e => { setTrimester(e.target.value as Trimester); setError(''); }}>{TRIMESTERS.map(t => <option key={t} value={t}>{trimesterOptionUi(t)}</option>)}</select></label>
    <label>{tr('subject')}<select value={subject} onChange={e => { setSubject(e.target.value); setError(''); }}>{courseSubjects(state, course).map(s => <option key={s} value={s}>{subjectUi(s)}</option>)}</select></label>
    <label>{tr('gradeMode')}<select value={gradeMode} onChange={e => setGradeMode(e.target.value as GradeMode)}>{state.centerConfiguration.hasLetterGrades && <option value="LETTER">{tr('letterGrades')}</option>}<option value="NUMERIC">{tr('numericGrades')}</option></select><small className="field-help">{gradeMode === 'LETTER' ? tr('letterGradesHelp') : tr('numericGradesHelp')}</small></label>
    <label className="elective-field"><input type="checkbox" checked={isElective} onChange={event => setIsElective(event.target.checked)} /><span><strong>{tr('electiveSubject')}</strong><small>{tr('electiveSubjectHelp')}</small></span></label>
    {error && <div className="inline-error"><Icon name="x" />{error}</div>}
    <div className="modal-actions"><button className="secondary" onClick={close}>{tr('cancel')}</button><button className="primary" onClick={() => void create()}>{tr('createSheet')}</button></div>
  </Modal>;
}

function WorksheetPage({ id, navigate, refresh, notify, courses, profile, centerConfiguration }: { id: number; navigate: (v: View) => void; refresh: () => Promise<void>; notify: (n: Notice) => void; courses: InitialState['courses']; profile: InitialState['profile']; centerConfiguration: InitialState['centerConfiguration'] }) {
  const [sheet, setSheet] = useState<WorksheetDetail | null>(null); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<WorksheetDetail['columns'][number] | null>(null);
  const [assessmentToDelete, setAssessmentToDelete] = useState<WorksheetDetail['columns'][number] | null>(null); const [confirmingSelectionClear, setConfirmingSelectionClear] = useState(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState<number | null>(null);
  const [managingElectiveStudents, setManagingElectiveStudents] = useState(false);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const gridGesture = useRef<{ start: { row: number; column: number }; origin: { row: number; column: number }; dragged: boolean; editor: HTMLInputElement | HTMLTextAreaElement | null; pointerId: number; capture: HTMLElement } | null>(null);
  const gridCursor = useRef<{ row: number; column: number } | null>(null);
  const load = useCallback(() => window.fullSeguiment.getWorksheet(id).then(setSheet), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const finishSelection = () => { gridGesture.current = null; };
    window.addEventListener('pointercancel', finishSelection);
    window.addEventListener('blur', finishSelection);
    return () => {
      window.removeEventListener('pointercancel', finishSelection);
      window.removeEventListener('blur', finishSelection);
    };
  }, []);
  if (!sheet) return <div className="page-loader"><div className="spinner" /></div>;
  const saveAssessment = async (input: { kind: AssessmentKind; name: string; assessmentDate: string; studentIds?: number[] | null }, columnId?: number) => {
    if (columnId) await window.fullSeguiment.updateAssessment(columnId, input);
    else {
      const updated = await window.fullSeguiment.addAssessment({ worksheetId: id, ...input });
      setActiveAssessmentId(updated.columns.find(column => !sheet.columns.some(previous => previous.id === column.id))?.id ?? null); setSelection(null);
      setSheet(updated);
    }
    setAdding(false); setEditing(null); await load(); await refresh();
  };
  const removeColumn = async (columnId: number) => { await window.fullSeguiment.deleteColumn(columnId); if (activeAssessmentId === columnId) setActiveAssessmentId(null); setSelection(null); await load(); await refresh(); };
  const exportSheet = async () => { const result = await window.fullSeguiment.exportWorksheet(id); if (result.ok) notify({ type: 'success', text: tr('exported') }); else if (result.code === 'PROFILE_REQUIRED') { notify({ type: 'error', text: tr('profileNeeded') }); navigate({ page: 'settings' }); } else if (result.code === 'STUDENTS_REQUIRED') notify({ type: 'error', text: tr('studentsNeeded') }); else if (result.code === 'INCOMPLETE_WORKSHEET') notify({ type: 'error', text: tr('worksheetIncomplete') }); else if (result.code === 'AMBIGUOUS_STUDENT_NAMES') notify({ type: 'error', text: worksheetStatusUi('ambiguousNames') }); };
  const activeAssessment = sheet.columns.find(column => column.id === activeAssessmentId) ?? sheet.columns[0] ?? null;
  const disabledStudentIds = new Set(sheet.disabledStudentIds ?? []);
  const activeStudents = sheet.students.filter(student => !disabledStudentIds.has(student.id));
  const currentStudentIds = new Set(sheet.activeStudentIds);
  const activeIndex = activeAssessment ? sheet.columns.findIndex(column => column.id === activeAssessment.id) : -1;
  const activeDatePending = Boolean(activeAssessment && activeStudents.some(student => sheet.applicability[`${student.id}:${activeAssessment.id}`] === 'UNRESOLVED'));
  const cellComplete = (studentId: number, columnId: number) => {
    const key = `${studentId}:${columnId}`;
    const status = sheet.applicability[key];
    return status === 'NOT_APPLICABLE' || status === 'APPLICABLE' && isCompleteGradeValue(sheet.values[key] ?? '', sheet.gradeMode, centerConfiguration.grades, centerConfiguration.notEvaluatedValue);
  };
  const activeComplete = Boolean(activeAssessment && activeStudents.every(student => cellComplete(student.id, activeAssessment.id)));
  const applicableCells = activeStudents.flatMap(student => sheet.columns.filter(column => sheet.applicability[`${student.id}:${column.id}`] === 'APPLICABLE'));
  const exportReady = Boolean(profile.firstName.trim() && profile.lastName.trim() && applicableCells.length && sheet.columns.length && activeStudents.every(student => sheet.columns.every(column => cellComplete(student.id, column.id))));
  const normalized = selection ? { top: Math.min(selection.start.row, selection.end.row), bottom: Math.max(selection.start.row, selection.end.row), left: Math.min(selection.start.column, selection.end.column), right: Math.max(selection.start.column, selection.end.column) } : null;
  const selectedCount = normalized ? (normalized.bottom - normalized.top + 1) * (normalized.right - normalized.left + 1) : 0;
  const valueAt = (row: number, column: number) => {
    if (!activeAssessment) return '';
    const key = `${activeStudents[row]?.id}:${activeAssessment.id}`;
    return GRID_FIELDS[column] === 'grade' ? sheet.values[key] ?? '' : sheet.observations[key] ?? '';
  };
  const applyGridValues = async (updates: Array<{ row: number; column: number; value: string }>) => {
    if (!activeAssessment) return;
    const values = { ...sheet.values }; const observations = { ...sheet.observations };
    const saves: Array<Promise<void>> = [];
    for (const update of updates) {
      const student = activeStudents[update.row]; const field = GRID_FIELDS[update.column];
      if (!student || !field) continue;
      const key = `${student.id}:${activeAssessment.id}`;
      if (field === 'grade' && sheet.applicability[key] !== 'APPLICABLE') continue;
      const value = field === 'grade' ? sheet.gradeMode === 'NUMERIC' ? normalizeGradeValue(update.value) : update.value.toLocaleUpperCase().slice(0, 12) : update.value;
      if (field === 'grade' && sheet.gradeMode === 'LETTER' && value !== '' && !isCompleteGradeValue(value, 'LETTER', centerConfiguration.grades, centerConfiguration.notEvaluatedValue)) { notify({ type: 'error', text: tr('invalidLetterGrade', { notEvaluatedValue: centerConfiguration.notEvaluatedValue }) }); continue; }
      if (field === 'grade') values[key] = value; else observations[key] = value;
      saves.push(window.fullSeguiment.saveCell(id, student.id, activeAssessment.id, field, value));
    }
    setSheet(current => current ? { ...current, values, observations } : current);
    await Promise.all(saves);
  };
  const updateLocalValue = (studentId: number, field: CellField, value: string) => {
    if (!activeAssessment) return;
    const key = `${studentId}:${activeAssessment.id}`;
    setSheet(current => current ? field === 'grade' ? { ...current, values: { ...current.values, [key]: value } } : { ...current, observations: { ...current.observations, [key]: value } } : current);
  };
  const copySelection = (event: React.ClipboardEvent) => {
    if (!normalized) return;
    event.preventDefault();
    const text = Array.from({ length: normalized.bottom - normalized.top + 1 }, (_, rowOffset) => Array.from({ length: normalized.right - normalized.left + 1 }, (_, columnOffset) => valueAt(normalized.top + rowOffset, normalized.left + columnOffset)).join('\t')).join('\n');
    event.clipboardData.setData('text/plain', text);
  };
  const pasteSelection = (event: React.ClipboardEvent) => {
    const focusedCell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-grid-row][data-grid-column]') : null;
    const origin = normalized ? { row: normalized.top, column: normalized.left } : focusedCell ? { row: Number(focusedCell.dataset.gridRow), column: Number(focusedCell.dataset.gridColumn) } : gridCursor.current;
    if (!origin) return;
    event.preventDefault();
    const pasted = event.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '').split('\n').map(row => row.split('\t'));
    const updates: Array<{ row: number; column: number; value: string }> = [];
    if (normalized && pasted.length === 1 && pasted[0].length === 1 && selectedCount > 1) {
      for (let row = normalized.top; row <= normalized.bottom; row++) for (let column = normalized.left; column <= normalized.right; column++) updates.push({ row, column, value: pasted[0][0] });
    } else {
      pasted.forEach((row, rowOffset) => row.forEach((value, columnOffset) => updates.push({ row: origin.row + rowOffset, column: origin.column + columnOffset, value })));
    }
    void applyGridValues(updates);
  };
  const clearSelection = () => {
    if (!normalized) return;
    const updates: Array<{ row: number; column: number; value: string }> = [];
    for (let row = normalized.top; row <= normalized.bottom; row++) for (let column = normalized.left; column <= normalized.right; column++) updates.push({ row, column, value: '' });
    void applyGridValues(updates);
  };
  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && selection && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      const cell = event.currentTarget.querySelector<HTMLElement>(`[data-grid-row="${selection.end.row}"][data-grid-column="${selection.end.column}"]`);
      cell?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus();
      setSelection(null);
      return;
    }
    if (event.key === 'Tab') { setSelection(null); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && activeStudents.length > 0 && (event.ctrlKey || event.metaKey || event.shiftKey || selection)) {
      event.preventDefault(); event.stopPropagation();
      const focusedCell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-grid-row][data-grid-column]') : null;
      const focused = focusedCell ? { row: Number(focusedCell.dataset.gridRow), column: Number(focusedCell.dataset.gridColumn) } : null;
      const start = selection?.start ?? focused ?? gridCursor.current ?? { row: 0, column: 0 };
      const end = selection?.end ?? focused ?? gridCursor.current ?? start;
      const jump = event.ctrlKey || event.metaKey;
      const next = {
        row: event.key === 'ArrowUp' ? jump ? 0 : Math.max(0, end.row - 1) : event.key === 'ArrowDown' ? jump ? activeStudents.length - 1 : Math.min(activeStudents.length - 1, end.row + 1) : end.row,
        column: event.key === 'ArrowLeft' ? jump ? 0 : Math.max(0, end.column - 1) : event.key === 'ArrowRight' ? jump ? GRID_FIELDS.length - 1 : Math.min(GRID_FIELDS.length - 1, end.column + 1) : end.column
      };
      (event.currentTarget as HTMLElement).focus();
      window.getSelection()?.removeAllRanges();
      gridCursor.current = next;
      setSelection({ start: event.shiftKey ? start : next, end: next });
      event.currentTarget.querySelector<HTMLElement>(`[data-grid-row="${next.row}"][data-grid-column="${next.column}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).focus();
      setSelection({ start: { row: 0, column: 0 }, end: { row: activeStudents.length - 1, column: GRID_FIELDS.length - 1 } });
      return;
    }
    if (event.key === 'Escape') { setSelection(null); return; }
    if (!normalized || !['Delete', 'Backspace'].includes(event.key)) return;
    const editingCell = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (editingCell && selectedCount === 1) return;
    event.preventDefault(); setConfirmingSelectionClear(true);
  };
  const cancelGridGesture = () => { gridGesture.current = null; };
  const beginCellSelection = (event: React.PointerEvent<HTMLElement>, row: number, column: number) => {
    if (event.button !== 0) return;
    const editor = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    const origin = { row, column };
    const start = event.shiftKey ? selection?.start ?? gridCursor.current ?? origin : origin;
    gridGesture.current = { start, origin, dragged: event.shiftKey, editor, pointerId: event.pointerId, capture: event.currentTarget };
    gridCursor.current = origin;
    if (editor && document.activeElement === editor && !event.shiftKey) {
      setSelection(null);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.shiftKey || !editor) event.currentTarget.closest<HTMLElement>('.assessment-table-wrap')?.focus();
    setSelection({ start, end: origin });
  };
  const extendCellSelection = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gridGesture.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-grid-row][data-grid-column]');
    if (!cell || cell.closest('.assessment-table-wrap') !== gesture.capture.closest('.assessment-table-wrap')) return;
    const end = { row: Number(cell.dataset.gridRow), column: Number(cell.dataset.gridColumn) };
    if (end.row === gesture.origin.row && end.column === gesture.origin.column && !gesture.dragged) return;
    gesture.dragged = true;
    gesture.capture.closest<HTMLElement>('.assessment-table-wrap')?.focus();
    window.getSelection()?.removeAllRanges();
    gridCursor.current = end;
    setSelection({ start: gesture.start, end });
  };
  const endCellSelection = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gridGesture.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gridGesture.current = null;
    if (gesture.capture.hasPointerCapture(event.pointerId)) gesture.capture.releasePointerCapture(event.pointerId);
    if (!gesture.dragged && gesture.editor) {
      setSelection(null);
      gesture.editor.focus();
    }
  };
  const selectAssessment = (assessmentId: number | null) => { gridCursor.current = null; gridGesture.current = null; setActiveAssessmentId(assessmentId); setSelection(null); };
  return <>
    <div className="sheet-toolbar compact-sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'dashboard' })}><Icon name="back" /> {tr('back')}</button><div className="compact-sheet-title"><span>{courses.find(course => course.id === sheet.courseLevel)?.name ?? sheet.courseLevel} · {trimesterUi(sheet.trimester)}</span><strong>{subjectUi(sheet.subject)}{sheet.isElective && <small className="elective-title-tag">{tr('elective')}</small>}</strong></div><div className="toolbar-actions">{sheet.isElective && <button className="secondary elective-students-button" title={tr('manageElectiveStudents')} onClick={() => setManagingElectiveStudents(true)}><Icon name="users" /> {activeStudents.length}/{sheet.students.length}</button>}<button className="primary export-icon-button" disabled={!exportReady} title={exportReady ? tr('export') : tr('exportRequirements')} aria-label={tr('export')} onClick={() => void exportSheet()}><Icon name="download" /></button></div></div>
    {sheet.students.length === 0 ? <Empty icon="users" title={tr('noCourseStudents')} text={tr('noCourseStudentsHelp')} action={<button className="primary" onClick={() => navigate({ page: 'settings' })}>{tr('goSettings')}</button>} /> :
      <div className="assessment-workspace">
        <section className="assessment-detail">
          <header className="assessment-compact-header"><label className="assessment-picker"><select aria-label={tr('availableAssessments')} value={activeAssessment?.id ?? ''} disabled={!activeAssessment} onChange={event => selectAssessment(Number(event.target.value))}>{activeAssessment ? sheet.columns.map(column => <option key={column.id} value={column.id}>{column.name} · {formatDateOnly(column.assessmentDate)} | {column.studentIds !== undefined ? individualAssessmentUi('individual') + ' · ' : ''}{column.kind === 'EXAM' ? tr('exam') : tr('continuous')}</option>) : <option value="">{tr('noAssessments')}</option>}</select>{activeAssessment && <b className={`assessment-state ${activeDatePending ? 'date-pending' : activeComplete ? 'complete' : 'incomplete'}`}>{activeDatePending ? tr('assessmentDatePending') : activeComplete ? tr('complete') : tr('incomplete')}</b>}</label><div className="assessment-actions"><button className="icon-action" title={tr('previous')} disabled={!activeAssessment || activeIndex <= 0} onClick={() => selectAssessment(sheet.columns[activeIndex - 1]?.id ?? null)}><Icon name="back" /></button><button className="icon-action next-assessment" title={tr('next')} disabled={!activeAssessment || activeIndex >= sheet.columns.length - 1} onClick={() => selectAssessment(sheet.columns[activeIndex + 1]?.id ?? null)}>→</button><i className="assessment-action-separator" /><button className="icon-action" title={tr('addAssessment')} onClick={() => setAdding(true)}><Icon name="plus" /></button><button className="icon-action" title={tr('editAssessment')} disabled={!activeAssessment} onClick={() => activeAssessment && setEditing(activeAssessment)}><Icon name="edit" /></button><button className="icon-action danger" title={activeAssessment?.sourceColumnId ? tr('cannotDeleteCopiedAssessment') : tr('deleteAssessment')} disabled={!activeAssessment || Boolean(activeAssessment?.sourceColumnId)} onClick={() => activeAssessment && setAssessmentToDelete(activeAssessment)}><Icon name="trash" /></button></div></header>
          {activeAssessment ? <>
            <div className="table-wrap assessment-table-wrap" tabIndex={0} onCopy={copySelection} onPaste={pasteSelection} onKeyDownCapture={handleGridKeyDown}><table className="data-table assessment-table"><thead><tr><th className="student-column"><span>{tr('student')}</span><small>{sheet.isElective ? tr('electiveStudents') : tr('courseList')}</small></th><th className="grade-column">{tr('grade')}</th><th>{tr('observation')}</th></tr></thead><tbody>{activeStudents.map((student, rowIndex) => {
              const key = `${student.id}:${activeAssessment.id}`; const status = sheet.applicability[key]; const missingGrade = status === 'APPLICABLE' && !cellComplete(student.id, activeAssessment.id);
              const selected = (column: number) => Boolean(normalized && rowIndex >= normalized.top && rowIndex <= normalized.bottom && column >= normalized.left && column <= normalized.right);
              return <tr className={missingGrade ? 'row-incomplete' : ''} key={key}><td className="student-name"><span>{rowIndex + 1}</span>{student.fullName}{!currentStudentIds.has(student.id) && <small> · {worksheetStatusUi('historical')}</small>}</td><td className={`grade-cell spreadsheet-cell ${missingGrade ? 'grade-incomplete' : ''} ${selected(0) ? 'cell-selected' : ''}`} data-grid-row={rowIndex} data-grid-column={0} onPointerDownCapture={event => beginCellSelection(event, rowIndex, 0)} onPointerMove={extendCellSelection} onPointerUp={endCellSelection} onLostPointerCapture={cancelGridGesture}>{status === 'APPLICABLE' ? <CellEditor field="grade" gradeMode={sheet.gradeMode} grades={centerConfiguration.grades} notEvaluatedValue={centerConfiguration.notEvaluatedValue} worksheetId={id} studentId={student.id} columnId={activeAssessment.id} initialValue={sheet.values[key] ?? ''} label={`${student.fullName}, ${tr('grade')}`} onValueChange={value => updateLocalValue(student.id, 'grade', value)} /> : <span title={status === 'UNRESOLVED' ? tr('assessmentDatePending') : worksheetStatusUi('notApplicable')}>{status === 'UNRESOLVED' ? tr('assessmentDatePending') : 'N/A'}{sheet.values[key] ? ` · ${sheet.values[key]}` : ''}</span>}</td><td className={`observation-cell spreadsheet-cell ${selected(1) ? 'cell-selected' : ''}`} data-grid-row={rowIndex} data-grid-column={1} onPointerDownCapture={event => beginCellSelection(event, rowIndex, 1)} onPointerMove={extendCellSelection} onPointerUp={endCellSelection} onLostPointerCapture={cancelGridGesture}><CellEditor field="observation" gradeMode={sheet.gradeMode} grades={centerConfiguration.grades} notEvaluatedValue={centerConfiguration.notEvaluatedValue} worksheetId={id} studentId={student.id} columnId={activeAssessment.id} initialValue={sheet.observations[key] ?? ''} label={`${student.fullName}, ${tr('observation')}`} onValueChange={value => updateLocalValue(student.id, 'observation', value)} /></td></tr>;
            })}</tbody></table></div>
          </> : <div className="assessment-empty-state"><span><Icon name="sheet" size={28} /></span><div><h2>{tr('noAssessments')}</h2><p>{tr('emptyAssessmentHelp')}</p></div></div>}
        </section>
      </div>}
    {adding && <AssessmentModal students={activeStudents} close={() => setAdding(false)} onSave={input => saveAssessment(input)} />}
    {managingElectiveStudents && <ElectiveStudentsModal sheet={sheet} close={() => setManagingElectiveStudents(false)} save={async enabledStudentIds => { const updated = await window.fullSeguiment.configureElectiveStudents(sheet.id, enabledStudentIds); setSheet(updated); setSelection(null); await refresh(); }} />}
    {editing && <AssessmentModal students={sheet.students} initial={editing} close={() => setEditing(null)} onSave={input => saveAssessment(input, editing.id)} />}
    {assessmentToDelete && <ConfirmDeleteModal title={tr('deleteAssessmentTitle')} question={tr('deleteAssessmentQuestion')} identifier={assessmentToDelete.name} note={tr('deleteAssessmentNote')} confirmationText={confirmationWord(assessmentToDelete.name)} confirmationPlaceholder={confirmationWord(assessmentToDelete.name)} close={() => setAssessmentToDelete(null)} confirm={() => removeColumn(assessmentToDelete.id)} />}
    {confirmingSelectionClear && <ConfirmDeleteModal title={tr('clearSelectionTitle')} question={tr('clearSelectionQuestion')} note={tr('clearSelectionNote')} close={() => setConfirmingSelectionClear(false)} confirm={clearSelection} />}
  </>;
}

function CellEditor({ worksheetId, studentId, columnId, initialValue, label, field, gradeMode, grades, notEvaluatedValue, onValueChange }: { worksheetId: number; studentId: number; columnId: number; initialValue: string; label: string; field: CellField; gradeMode: GradeMode; grades: InitialState['centerConfiguration']['grades']; notEvaluatedValue: string; onValueChange: (value: string) => void }) {
  const latestValue = useRef(initialValue);
  const timer = useRef<number | null>(null);
  const [draftState, setDraftState] = useState({ value: initialValue, source: initialValue });
  const draft = draftState.source === initialValue ? draftState.value : initialValue;
  const setDraft = (value: string) => setDraftState({ value, source: initialValue });
  const [letterError, setLetterError] = useState(false);
  const save = (next: string) => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; void window.fullSeguiment.saveCell(worksheetId, studentId, columnId, field, next); };
  const scheduleSave = (next: string) => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(next), 350); };
  useEffect(() => { latestValue.current = initialValue; }, [initialValue]);
  useEffect(() => () => { if (timer.current !== null) { window.clearTimeout(timer.current); void window.fullSeguiment.saveCell(worksheetId, studentId, columnId, field, latestValue.current); } }, [columnId, field, studentId, worksheetId]);
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const raw = event.target.value;
    const next = field === 'grade' ? gradeMode === 'NUMERIC' ? normalizeGradeValue(raw) : raw.toLocaleUpperCase().slice(0, 12) : raw;
    if (field === 'grade' && gradeMode === 'LETTER') {
      const valid = next === '' || isCompleteGradeValue(next, 'LETTER', grades, notEvaluatedValue);
      setDraft(next); setLetterError(next !== '' && !valid);
      if (!valid) return;
    }
    latestValue.current = next; onValueChange(next); scheduleSave(next);
  };
  const handleBlur = () => {
    if (field === 'grade' && gradeMode === 'LETTER') {
      if (draft !== '' && !isCompleteGradeValue(draft, 'LETTER', grades, notEvaluatedValue)) { setDraft(initialValue); setLetterError(true); latestValue.current = initialValue; return; }
      save(draft); return;
    }
    save(initialValue);
  };
  const common = { value: field === 'grade' && gradeMode === 'LETTER' ? draft : initialValue, 'aria-label': label, onChange: handleChange, onBlur: handleBlur, onPaste: () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; } };
  const displayedGrade = field === 'grade' && gradeMode === 'LETTER' ? draft : initialValue;
  const gradeMissing = displayedGrade.trim() === '';
  const normalizedGrade = normalizeGradeValue(displayedGrade);
  const numericGrade = gradeMode === 'LETTER' ? numericValueForLetterGrade(normalizedGrade, grades) : Number(displayedGrade.replace(',', '.')); const validGrade = isCompleteGradeValue(displayedGrade, gradeMode, grades, notEvaluatedValue);
  const gradeClass = gradeMissing ? 'grade-missing' : normalizedGrade === normalizeGradeValue(notEvaluatedValue) ? 'grade-neutral' : validGrade && numericGrade !== undefined && numericGrade >= 5 ? 'grade-pass' : 'grade-fail';
  if (field === 'grade' && gradeMode === 'LETTER') return <input {...common} className={`grade-letter ${gradeClass} ${letterError ? 'grade-missing' : ''}`} type="text" maxLength={12} spellCheck={false} autoComplete="off" autoCapitalize="characters" aria-invalid={!validGrade || letterError} title={[...grades.map(item => item.grade), notEvaluatedValue].join(', ')} />;
  return field === 'grade' ? <input {...common} className={gradeClass} type="text" maxLength={12} inputMode="decimal" spellCheck={false} autoCapitalize="characters" aria-invalid={!validGrade} /> : <textarea {...common} rows={1} placeholder={tr('observationPlaceholder')} />;
}

function CopyWorksheetModal({ subject, sourceTrimester, existingTrimesters, close, onSave }: { subject: string; sourceTrimester: Trimester; existingTrimesters: Trimester[]; close: () => void; onSave: (trimester: Trimester) => Promise<void> }) {
  const [trimester, setTrimester] = useState<Trimester | ''>(''); const [error, setError] = useState('');
  const available = TRIMESTERS.filter(item => item !== sourceTrimester && !existingTrimesters.includes(item));
  const save = async () => {
    if (!trimester) { setError(tr('copySheetTrimesterRequired')); return; }
    try { await onSave(trimester); } catch (caught) { setError(caught instanceof Error && caught.message.includes('DUPLICATE_WORKSHEET') ? tr('duplicateSheet', { sheet: `${subject} · ${trimesterUi(trimester)}` }) : tr('copySheetError')); }
  };
  return <Modal title={tr('copySheetTitle')} subtitle={tr('copySheetHelp')} close={close}>
    <label>{tr('targetTrimester')}<select value={trimester} onChange={event => { setTrimester(event.target.value as Trimester); setError(''); }}><option value="">{tr('selectTrimester')}</option>{available.map(item => <option key={item} value={item}>{trimesterUi(item)}</option>)}</select></label>
    <div className="copy-warning">{tr('copySheetWarning')}</div>
    {!available.length && <div className="inline-error">{tr('copySheetNoTrimesters')}</div>}
    {error && <div className="inline-error"><Icon name="x" />{error}</div>}
    <div className="modal-actions"><button className="secondary" onClick={close}>{tr('cancel')}</button><button className="primary" disabled={!trimester || !available.length} onClick={() => void save()}>{tr('copySheet')}</button></div>
  </Modal>;
}

function AssessmentModal({ initial, students, close, onSave }: { initial?: WorksheetDetail['columns'][number]; students: WorksheetDetail['students']; close: () => void; onSave: (input: { kind: AssessmentKind; name: string; assessmentDate: string; studentIds?: number[] | null }) => Promise<void> }) {
  const [kind, setKind] = useState<AssessmentKind>(initial?.kind ?? 'EXAM');
  const [individual, setIndividual] = useState(initial?.studentIds !== undefined);
  const [selected, setSelected] = useState<Set<number>>(new Set(initial?.studentIds ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(initial?.name ?? '');
  const [assessmentDate, setAssessmentDate] = useState(initial?.assessmentDate || new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);
  const save = async () => {
    setSubmitted(true);
    if (saving || !name.trim() || !assessmentDate || individual && !selected.size) return;
    setSaving(true); setError('');
    try { await onSave({ kind, name, assessmentDate, studentIds: individual ? [...selected] : null }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  };
  return <Modal title={initial ? tr('editAssessment') : tr('newAssessment')} subtitle={tr('assessmentHelp')} close={close} className="assessment-modal">
    <label>{tr('assessmentType')}<select value={individual ? 'INDIVIDUAL' : kind} onChange={event => { const value = event.target.value; setIndividual(value === 'INDIVIDUAL'); if (value !== 'INDIVIDUAL') setKind(value as AssessmentKind); }}><option value="EXAM">{tr('exam')}</option><option value="CONTINUOUS_ASSESSMENT">{tr('continuous')}</option><option value="INDIVIDUAL">{individualAssessmentUi('individual')}</option></select></label>
    {individual && <>
      <label>{individualAssessmentUi('countsAs')}<select value={kind} onChange={event => setKind(event.target.value as AssessmentKind)}><option value="EXAM">{tr('exam')}</option><option value="CONTINUOUS_ASSESSMENT">{tr('continuous')}</option></select></label>
      <p className="individual-assessment-help">{individualAssessmentUi('help')}</p>
      <fieldset className="individual-assessment-students"><legend>{individualAssessmentUi('students')} · {selected.size}</legend><div className="elective-student-list">{students.map(student => <label key={student.id}><input type="checkbox" checked={selected.has(student.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(student.id); else next.delete(student.id); return next; })} /><strong>{student.fullName}</strong></label>)}</div></fieldset>
      {submitted && !selected.size && <div className="inline-error">{individualAssessmentUi('required')}</div>}
    </>}
    <label>{tr('assessmentDate')}<input className={submitted && !assessmentDate ? 'field-invalid' : ''} aria-invalid={submitted && !assessmentDate} type="date" value={assessmentDate} onChange={event => setAssessmentDate(event.target.value)} />{submitted && !assessmentDate && <small className="field-error">{tr('requiredField')}</small>}</label>
    <label>{tr('assessmentName')}<input className={submitted && !name.trim() ? 'field-invalid' : ''} aria-invalid={submitted && !name.trim()} autoFocus value={name} placeholder={tr('assessmentNamePlaceholder')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} />{submitted && !name.trim() && <small className="field-error">{tr('requiredField')}</small>}</label>
    {submitted && (!name.trim() || !assessmentDate) && <div className="inline-error"><Icon name="x" />{tr('missingRequiredFields')}</div>}
    {error && <div className="inline-error">{error}</div>}
    <div className="modal-actions"><button className="secondary" disabled={saving} onClick={close}>{tr('cancel')}</button><button className="primary" disabled={saving} onClick={() => void save()}>{initial ? tr('saveChanges') : tr('createAssessment')}</button></div>
  </Modal>;
}

function ElectiveStudentsModal({ sheet, close, save }: { sheet: WorksheetDetail; close: () => void; save: (enabledStudentIds: number[]) => Promise<void> }) {
  const initiallyEnabled = sheet.students.filter(student => !(sheet.disabledStudentIds ?? []).includes(student.id)).map(student => student.id);
  const [enabled, setEnabled] = useState<Set<number>>(new Set(initiallyEnabled));
  const [busy, setBusy] = useState(false);
  const submit = async () => { if (enabled.size === 0) return; setBusy(true); try { await save([...enabled]); close(); } finally { setBusy(false); } };
  return <Modal title={tr('manageElectiveStudents')} subtitle={tr('manageElectiveStudentsHelp')} close={close} className="elective-students-modal">
    <div className="elective-selection-summary"><strong>{tr('selectedStudents', { count: enabled.size })}</strong><div><button type="button" onClick={() => setEnabled(new Set(sheet.students.map(student => student.id)))}>{tr('selectAll')}</button><button type="button" onClick={() => setEnabled(new Set())}>{tr('selectNone')}</button></div></div>
    <div className="elective-student-list">{sheet.students.map((student, index) => <label key={student.id}><input type="checkbox" checked={enabled.has(student.id)} onChange={event => setEnabled(current => { const next = new Set(current); if (event.target.checked) next.add(student.id); else next.delete(student.id); return next; })} /><span className="student-order">{index + 1}</span><strong>{student.fullName}</strong></label>)}</div>
    {enabled.size === 0 && <div className="inline-error"><Icon name="x" />{tr('electiveStudentsRequired')}</div>}
    <div className="modal-actions"><button className="secondary" disabled={busy} onClick={close}>{tr('cancel')}</button><button className="primary" disabled={busy || enabled.size === 0} onClick={() => void submit()}>{tr('saveChanges')}</button></div>
  </Modal>;
}

function ConfigurationGradeDetails({ configuration, language }: { configuration: InitialState['centerConfiguration']; language: AppLanguage }) {
  const labels = configurationDetailLabels[language];
  return <>
    {configuration.hasAssessmentWeights && <div className="configuration-weight-cards">
      <div><span>{tr('exam')}</span><strong>{configuration.examWeight}<small>%</small></strong></div>
      <div><span>{tr('continuous')}</span><strong>{configuration.continuousAssessmentWeight}<small>%</small></strong></div>
    </div>}
    <div className="configuration-grade-mode"><span>{tr('gradeMode')}</span><strong>{configuration.finalReportGradeMode === 'LETTER' ? tr('letterGrades') : tr('numericGrades')}</strong></div>
    {configuration.hasLetterGrades && <section className="configuration-grade-section">
      <strong className="configuration-detail-title">{labels.scale}</strong>
      <dl className="configuration-grade-thresholds">{configuration.grades.map(grade => <div key={grade.grade}><dt>{grade.grade}</dt><dd>{grade.from}</dd></div>)}</dl>
      {Object.keys(configuration.gradesExplanation ?? {}).length > 0 && <dl className="configuration-grade-meanings">{Object.entries(configuration.gradesExplanation ?? {}).map(([grade, explanation]) => <div key={grade}><dt>{grade}</dt><dd>{explanation}</dd></div>)}</dl>}
    </section>}
    <div className="configuration-not-evaluated"><span>{labels.notEvaluated}</span><strong>{configuration.notEvaluatedValue}</strong></div>
  </>;
}

function BackupPanel({ language, refresh }: { language: AppLanguage; refresh: () => Promise<void> }) {
  const labels = backupLabels[language];
  const [preview, setPreview] = useState<Extract<BackupPreviewResult, { ok: true }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const run = async (action: 'export' | 'preview' | 'restore') => {
    if (busy) return;
    setBusy(true); setMessage(''); setError(false);
    try {
      if (action === 'preview') {
        const result = await window.fullSeguiment.previewBackup();
        if (result.ok) setPreview(result);
        else if (!result.cancelled) { setError(true); setMessage(labels.error); }
      } else {
        const result = action === 'export' ? await window.fullSeguiment.exportBackup() : preview ? await window.fullSeguiment.restoreBackup(preview.token) : null;
        if (result?.ok) {
          setMessage(`${action === 'export' ? labels.saved : labels.restored} ${result.path}`);
          if (action === 'restore') { setPreview(null); await refresh(); }
        } else if (result && !result.cancelled) { setPreview(null); setError(true); setMessage(labels.error); }
      }
    } catch { setError(true); setMessage(labels.error); }
    finally { setBusy(false); }
  };
  const cancel = () => { if (!busy) { setPreview(null); void window.fullSeguiment.cancelBackup(); } };
  return <section className="panel backup-panel"><div className="panel-heading"><span className="panel-icon"><Icon name="database" size={22} /></span><div><h2>{labels.title}</h2><p>{labels.help}</p></div></div>
    <div className="configuration-card backup-card"><div className="configuration-card-heading"><span><Icon name="copy" /></span><div><h3>{backupContentLabels[language]}</h3></div></div><div className="backup-card-actions"><button className="primary" disabled={busy} aria-busy={busy} onClick={() => void run('export')}><Icon name="download" />{labels.export}</button><button className="secondary" disabled={busy} onClick={() => void run('preview')}><Icon name="upload" />{labels.restore}</button></div></div>
    {message && <div role="status" className={`backup-feedback ${error ? 'is-error' : ''}`}><Icon name={error ? 'x' : 'check'} /><p>{message}</p></div>}
    {preview && <Modal title={labels.preview} subtitle={labels.warning} close={cancel} className="backup-preview-modal">
      <p>{labels.date}: {formatDate(preview.summary.createdAt)}</p><p>{labels.teacher}: {preview.summary.teacher || '—'}</p>
      <dl className="backup-summary">{labels.counts.split(' · ').map((label, index) => <div key={index}><dt>{label}</dt><dd>{[preview.summary.courses, preview.summary.students, preview.summary.worksheets, preview.summary.reports][index]}</dd></div>)}</dl>
      <div className="modal-actions"><button className="secondary" disabled={busy} onClick={cancel}>{labels.cancel}</button><button className="danger-confirm" disabled={busy} aria-busy={busy} onClick={() => void run('restore')}>{labels.confirm}</button></div>
    </Modal>}
  </section>;
}

function Settings({ state, refresh, notify, onProfileChange }: { state: InitialState; refresh: () => Promise<void>; notify: (n: Notice) => void; onProfileChange: (profile: InitialState['profile']) => void }) {
  const [firstName, setFirstName] = useState(state.profile.firstName); const [lastName, setLastName] = useState(state.profile.lastName); const [sex, setSex] = useState<TeacherSex>(state.profile.sex === 'FEMALE' ? 'FEMALE' : 'MALE');
  const [deleteTarget, setDeleteTarget] = useState<'center' | 'logo' | null>(null);
  const [centerPreview, setCenterPreview] = useState<CenterPreviewResult | null>(null);
  const hasCenterData = Boolean(state.courses.length || state.subjects.length || state.students.length || state.worksheets.length || state.imports.length);
  const latestProfile = useRef({ firstName: state.profile.firstName, lastName: state.profile.lastName, sex: state.profile.sex === 'FEMALE' ? 'FEMALE' as const : 'MALE' as const }); const profileTimer = useRef<number | null>(null); const profileDirty = useRef(false); const profileRevision = useRef(0);
  const persistProfile = useCallback(async (showNotice = true) => { if (profileTimer.current !== null) window.clearTimeout(profileTimer.current); profileTimer.current = null; if (!profileDirty.current) return; const revision = profileRevision.current; const saved = await window.fullSeguiment.saveProfile({ ...latestProfile.current }); if (profileRevision.current !== revision) return; profileDirty.current = false; onProfileChange(saved); if (showNotice) notify({ type: 'success', text: tr('profileSaved') }); }, [notify, onProfileChange]);
  const changeProfile = (field: 'firstName' | 'lastName', value: string) => { if (field === 'firstName') setFirstName(value); else setLastName(value); latestProfile.current = { ...latestProfile.current, [field]: value }; profileDirty.current = true; profileRevision.current += 1; if (profileTimer.current !== null) window.clearTimeout(profileTimer.current); profileTimer.current = window.setTimeout(() => void persistProfile(), 350); };
  const changeSex = async (value: TeacherSex) => { setSex(value); latestProfile.current = { ...latestProfile.current, sex: value }; profileDirty.current = true; profileRevision.current += 1; await persistProfile(); };
  useEffect(() => () => { void persistProfile(false); }, [persistProfile]);
  const loadCenterData = async () => {
    const result = await window.fullSeguiment.importCenterData(); if (result.cancelled) return;
    if (!result.ok) { notify({ type: 'error', text: result.rosterChanges ? centerRosterChangeMessage(result.rosterChanges) : localizedError(result.error, 'configurationImportError') }); return; }
    await refresh(); notify({ type: 'success', text: tr('centerDataLoaded', { courses: result.courses?.length ?? 0, subjects: result.subjects?.length ?? 0, students: result.students?.length ?? 0 }) });
  };
  const previewCenterData = async () => {
    const result = await window.fullSeguiment.analyzeCenterImport();
    if (!result.ok) { if (!result.cancelled) notify({ type: 'error', text: localizedError(result.error, 'configurationImportError') }); return; }
    setCenterPreview(result);
  };
  const cancelCenterPreview = async () => { await window.fullSeguiment.cancelCenterImport(); setCenterPreview(null); };
  const applyCenterPreview = async (effectiveDate: string | null, assignments: CenterUpdateAssignment[]) => {
    if (!centerPreview) return false;
    const result = await window.fullSeguiment.applyCenterImport(centerPreview.token, effectiveDate, assignments);
    if (!result.ok) { notify({ type: 'error', text: localizedError(result.error, 'configurationImportError') }); return false; }
    setCenterPreview(null);
    await refresh();
    notify({ type: 'success', text: tr('centerDataLoaded', { courses: result.courses?.length ?? 0, subjects: result.subjects?.length ?? 0, students: result.students?.length ?? 0 }) });
    return true;
  };
  const clearCenterData = async () => { await window.fullSeguiment.clearCenterData(); await refresh(); notify({ type: 'success', text: tr('centerDataDeleted') }); };
  const loadLogo = async () => { const result = await window.fullSeguiment.chooseSchoolLogo(); if (result.cancelled) return; if (!result.ok) { notify({ type: 'error', text: localizedError(result.error, 'configurationImportError') }); return; } await refresh(); notify({ type: 'success', text: tr('logoLoaded') }); };
  const removeLogo = async () => { await window.fullSeguiment.removeSchoolLogo(); await refresh(); };
  return <div className="settings-page">
    <PageHeader eyebrow={tr('localPreferences')} title={tr('settings')} subtitle={tr('settingsHelp')} />
    <section className="panel school-configuration"><div className="panel-heading"><span className="panel-icon"><Icon name="settings" /></span><div><h2>{tr('schoolConfiguration')}</h2><p>{tr('schoolConfigurationHelp')}</p></div></div><div className="configuration-cards">
      <article className="configuration-card"><div className="configuration-card-heading"><span><Icon name="school" /></span><div><h3>{tr('centerData')}</h3></div></div><div className={`configuration-status-list ${hasCenterData ? 'loaded' : 'missing'}`}><div className="configuration-detail"><small className="configuration-status" tabIndex={hasCenterData ? 0 : undefined} aria-describedby={hasCenterData ? 'center-data-details' : undefined}>{hasCenterData ? tr('centerDataLoaded', { courses: state.courses.length, subjects: state.subjects.length, students: state.students.length }) : tr('noCenterData')}</small>{hasCenterData && <div className="configuration-tooltip" id="center-data-details" role="region" aria-label={tr('centerData')}>{state.courses.map(course => <div className="configuration-tooltip-course" key={course.id}><strong>{course.name}</strong><details className="configuration-course-list"><summary>{tr('studentsConfigured')} <b>{state.students.filter(student => student.courseLevel === course.id).length}</b></summary><ol>{state.students.filter(student => student.courseLevel === course.id).map(student => <li key={student.id}>{student.fullName}</li>)}</ol></details><details className="configuration-course-list"><summary>{tr('configuredSubjects')} <b>{state.subjects.filter(subject => subject.courseId === course.id).length}</b></summary><ul>{state.subjects.filter(subject => subject.courseId === course.id).map(subject => <li key={subject.name}>{subject.name}</li>)}</ul></details></div>)}</div>}</div><div className="configuration-detail"><small className="configuration-status" tabIndex={0} aria-describedby="center-grade-details">{tr(state.centerConfiguration.hasAssessmentWeights ? 'centerAssessmentConfiguration' : 'centerAssessmentConfigurationMissing', { format: state.centerConfiguration.finalReportGradeMode === 'LETTER' ? tr('letterGrades') : tr('numericGrades') })}</small><div className="configuration-tooltip configuration-grades-tooltip" id="center-grade-details" role="tooltip"><ConfigurationGradeDetails configuration={state.centerConfiguration} language={state.language} /></div></div></div><div className="configuration-actions"><button className="icon-button sheet-card-icon-action sheet-export-button configuration-action" title={tr('loadCenterData')} aria-label={tr('loadCenterData')} onClick={() => void (hasCenterData ? previewCenterData() : loadCenterData())}><Icon name="upload" /></button><button className="icon-button danger sheet-card-icon-action configuration-delete" title={tr('deleteCenterData')} aria-label={tr('deleteCenterData')} disabled={!hasCenterData} onClick={() => setDeleteTarget('center')}><Icon name="trash" /></button></div></article>
      <article className="configuration-card"><div className="configuration-card-heading"><span><Icon name="image" /></span><div><h3>{tr('schoolLogo')}</h3></div></div><div className="logo-state-row"><div className="logo-status-preview"><span className={`configuration-status ${state.schoolLogo ? 'loaded' : 'missing'}`} tabIndex={state.schoolLogo ? 0 : undefined}>{state.schoolLogo ? tr('logoLoadedStatus') : tr('noLogoLoaded')}</span>{state.schoolLogo && <div className="logo-hover-preview" role="tooltip"><img src={state.schoolLogo} alt={tr('schoolLogo')} /></div>}</div></div><div className="configuration-actions"><button className="icon-button sheet-card-icon-action sheet-export-button configuration-action" title={tr('loadLogo')} aria-label={tr('loadLogo')} onClick={() => void loadLogo()}><Icon name="upload" /></button><button className="icon-button danger sheet-card-icon-action configuration-delete" title={tr('removeLogo')} aria-label={tr('removeLogo')} disabled={!state.schoolLogo} onClick={() => setDeleteTarget('logo')}><Icon name="trash" /></button></div></article>
    </div></section>
    <section className="panel teacher-profile-panel"><div className="panel-heading"><span className="panel-icon"><Icon name="teacher" /></span><div><h2>{tr('teacherData')}</h2><p>{tr('teacherDataHelp')}</p></div></div><div className="teacher-profile-fields"><label>{tr('firstName')}<input value={firstName} onChange={e => changeProfile('firstName', e.target.value)} onBlur={() => void persistProfile()} placeholder={tr('yourName')} /></label><label>{tr('lastName')}<input value={lastName} onChange={e => changeProfile('lastName', e.target.value)} onBlur={() => void persistProfile()} placeholder={tr('yourLastName')} /></label><label>{tr('sex')}<select required aria-required="true" value={sex} onChange={event => void changeSex(event.target.value as TeacherSex)}><option value="MALE">{tr('male')}</option><option value="FEMALE">{tr('female')}</option></select></label></div></section>
    {deleteTarget === 'center' && <ConfirmDeleteModal title={tr('deleteCenterDataTitle')} question={tr('deleteCenterDataQuestion')} identifier={tr('centerData')} note={tr('deleteCenterDataNote')} confirmationText="datos" confirmationPlaceholder="datos" close={() => setDeleteTarget(null)} confirm={clearCenterData} />}
    {deleteTarget === 'logo' && <ConfirmDeleteModal title={tr('removeLogoTitle')} question={tr('removeLogoQuestion')} identifier={tr('schoolLogo')} note={tr('removeLogoNote')} confirmationText="logo" confirmationPlaceholder="logo" close={() => setDeleteTarget(null)} confirm={removeLogo} />}
    <BackupPanel language={state.language} refresh={async () => {
      const next = await window.fullSeguiment.getInitialState();
      latestProfile.current = { ...next.profile, sex: next.profile.sex === 'FEMALE' ? 'FEMALE' : 'MALE' }; profileDirty.current = false; profileRevision.current += 1;
      setFirstName(next.profile.firstName); setLastName(next.profile.lastName); setSex(next.profile.sex === 'FEMALE' ? 'FEMALE' : 'MALE');
      await refresh();
    }} />
    {centerPreview && <CenterUpdatePreviewModal result={centerPreview} cancel={() => void cancelCenterPreview()} apply={applyCenterPreview} />}
  </div>;
}

function CenterUpdatePreviewModal({ result, cancel, apply }: { result: CenterPreviewResult; cancel: () => void; apply: (date: string | null, assignments: CenterUpdateAssignment[]) => Promise<boolean> }) {
  const copy = centerUpdateText[getActiveLanguage()];
  const [effectiveDate, setEffectiveDate] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { assignments, unresolved, duplicateAssignment, canConfirm } = prepareCenterUpdateConfirmation(result.preview, choices, effectiveDate);
  const canApply = !busy && canConfirm;
  const summary = (label: string, names: string[]) => <div className="center-update-summary"><strong>{label}</strong><span>{names.length ? names.join(' · ') : copy.noChanges}</span></div>;
  const confirm = async () => { if (!canApply) return; setBusy(true); try { await apply(result.preview.rosterChanged ? effectiveDate : null, assignments); } finally { setBusy(false); } };
  const safeCancel = () => { if (!busy) cancel(); };
  return <Modal title={copy.title} subtitle={copy.explanation} close={safeCancel} className="center-update-modal">
    <div className="center-update-warning">{copy.preservation}</div>
    {summary(copy.omittedCourses, result.preview.omittedCourses)}
    {result.preview.configurationChanged && <div className={result.preview.configurationBlocked ? 'center-update-error' : 'center-update-summary'}>{result.preview.configurationBlocked ? copy.configurationBlocked : copy.configurationChanged}</div>}
    {result.preview.courses.map(course => <section className="center-update-course" key={course.courseId}>
      <h3>{course.courseName} <small>{course.isNew ? copy.newCourse : copy.existingCourse}</small></h3>
      {summary(copy.addedSubjects, course.addedSubjects)}
      {summary(copy.omittedSubjects, course.omittedSubjects)}
      {summary(copy.unchangedStudents, course.unchanged.map(student => student.name))}
      {summary(copy.removedStudents, course.removed.map(student => student.name))}
      {course.possibleNameChanges && summary(copy.possibleRenames, course.possibleNameChanges.incoming)}
      <div className="center-update-summary"><strong>{copy.addedStudents}</strong>{course.added.length ? course.added.map(name => {
        const key = centerUpdateChoiceKey(course.courseId, name);
        const ambiguous = course.ambiguousMatches.some(item => item.name === name);
        const candidates = [...new Map([...course.removed, ...course.historicalStudents].map(student => [student.id, student])).values()];
        return <label className="center-update-assignment" key={key}><span>{name} — {copy.renameChoice}</span><select value={choices[key] ?? (ambiguous ? '' : 'new')} onChange={event => setChoices(current => ({ ...current, [key]: event.target.value }))}>
          {ambiguous && <option value="">{copy.unresolved}</option>}
          <option value="new">{copy.newPerson}</option>
          {candidates.map(student => <option value={student.id} key={student.id}>{student.name}</option>)}
        </select></label>;
      }) : <span>{copy.noChanges}</span>}</div>
    </section>)}
    {result.preview.rosterChanged && <label className="center-update-date">{copy.effectiveDate}<input type="date" required value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} /></label>}
    {unresolved && <div className="center-update-error">{copy.unresolved}</div>}
    {duplicateAssignment && <div className="center-update-error">{copy.duplicateAssignment}</div>}
    <div className="center-update-actions"><button type="button" className="secondary" disabled={busy} onClick={safeCancel}>{copy.cancel}</button><button type="button" className="primary" disabled={!canApply} onClick={() => void confirm()}>{copy.confirm}</button></div>
  </Modal>;
}

function HelpPage() {
  const [route, setRoute] = useState<'start' | 'teacher' | 'tutor'>('start');
  const examples: Record<AppLanguage, { headers: string; course: string; subjects: [string, string]; students: [string, string] }> = {
    es: { headers: 'Curso;Asignaturas;Alumnos', course: '1.º ESO', subjects: ['Lengua Castellana', 'Matemáticas'], students: ['Ana Pérez', 'Marcos López'] },
    ca: { headers: 'Curs;Assignatures;Alumnes', course: '1r ESO', subjects: ['Llengua Catalana', 'Matemàtiques'], students: ['Anna Pérez', 'Marc López'] },
    en: { headers: 'Course;Subjects;Students', course: 'Year 1 ESO', subjects: ['English Language', 'Mathematics'], students: ['Anna Smith', 'Mark Jones'] },
    eu: { headers: 'Maila;Irakasgaiak;Ikasleak', course: 'DBH 1', subjects: ['Euskara', 'Matematika'], students: ['Ane Agirre', 'Mikel Arrieta'] },
    gl: { headers: 'Curso;Materias;Alumnos', course: '1.º ESO', subjects: ['Lingua Galega', 'Matemáticas'], students: ['Ana Pérez', 'Marcos López'] }
  };
  const example = examples[getActiveLanguage()];
  const csvExample = `${example.headers}\n${example.course};${example.subjects.join('|')};${example.students.join('|')}`;
  const jsonExample = JSON.stringify({ courses: [{ name: example.course, subjects: example.subjects, students: example.students }] }, null, 2);
  type HelpStep = { title: string; description: string; details?: string[] };
  const guides: Record<typeof route, { icon: Parameters<typeof Icon>[0]['name']; title: string; subtitle: string; steps: HelpStep[] }> = {
    start: { icon: 'settings', title: tr('helpGettingStarted'), subtitle: tr('helpGettingStartedText'), steps: [
      { title: tr('helpLoadCenter'), description: tr('helpCenterDataText'), details: [tr('helpCenterFileStep'), tr('helpCenterLogoStep')] },
      { title: tr('helpTeacherProfile'), description: tr('helpTeacherProfileText') },
      { title: tr('teacher'), description: tr('helpTeacherWorkflowText') },
      { title: tr('tutor'), description: tr('helpTutorWorkflowText') }
    ] },
    teacher: { icon: 'teacher', title: tr('teacher'), subtitle: tr('teacherHelp'), steps: [
      { title: tr('helpCreateSubject'), description: tr('helpCreateSubjectText') },
      { title: tr('helpAssessments'), description: tr('helpAssessmentsText') },
      { title: tr('helpGrades'), description: tr('helpGradesText') },
      { title: tr('helpSpreadsheet'), description: tr('helpSpreadsheetText') },
      { title: tr('helpCompletion'), description: tr('helpCompletionText') }
    ] },
    tutor: { icon: 'tutor', title: tr('tutor'), subtitle: tr('tutorHelp'), steps: [
      { title: tr('helpTutorImport'), description: tr('helpTutorImportText') },
      { title: tr('helpTutorReview'), description: tr('helpTutorReviewText') },
      { title: tr('helpTutorObservations'), description: tr('tutorObservationsHelp') },
      { title: tr('generateTrackingSheets'), description: tr('helpTutorGenerateText') }
    ] }
  };
  const guide = guides[route];
  return <><PageHeader eyebrow={tr('helpCenter')} title={tr('helpTitle')} subtitle={tr('helpIntro')} />
    <nav className="help-route-tabs" aria-label={tr('helpTitle')}>
      <button className={route === 'start' ? 'active' : ''} onClick={() => setRoute('start')}><Icon name="settings" />{tr('helpGettingStarted')}</button>
      <button className={route === 'teacher' ? 'active' : ''} onClick={() => setRoute('teacher')}><Icon name="teacher" />{tr('teacher')}</button>
      <button className={route === 'tutor' ? 'active' : ''} onClick={() => setRoute('tutor')}><Icon name="tutor" />{tr('tutor')}</button>
    </nav>
    <div className="help-grid help-guide-grid">
      <section className="help-card help-guide-card"><div className="help-card-title"><span><Icon name={guide.icon} /></span><div><h2>{guide.title}</h2><p>{guide.subtitle}</p></div></div><div className="help-topic-list">{guide.steps.map((step, index) => <article key={`${route}-${step.title}`}><b>{index + 1}</b><div><strong>{step.title}</strong><span>{step.description}</span>{step.details && <ol className="help-substeps">{step.details.map((detail, detailIndex) => <li key={detail}><b>{index + 1}.{detailIndex + 1}</b><span>{detail}</span></li>)}</ol>}</div></article>)}</div></section>
      {route === 'start' && <section className="help-card help-format-card"><div className="help-card-title"><span><Icon name="sheet" /></span><div><h2>{tr('helpDataFormats')}</h2><p>{tr('helpCenterDataText')}</p></div></div><div className="help-formats"><FormatExample title="CSV" code={csvExample} note={tr('helpListSeparator')} /><FormatExample title="JSON" code={jsonExample} note={tr('helpJsonKeysNote')} /><div className="format-example image-format-example"><strong>{tr('imageFile')}</strong><div><b>PNG · JPG · JPEG · WEBP</b></div><aside className="format-note">{tr('helpLogoFormat')}</aside></div></div></section>}
    </div>
  </>;
}

function FormatExample({ title, code, note }: { title: string; code: string; note?: string }) { return <div className="format-example"><strong>{title}</strong><pre><code>{code}</code></pre>{note && <aside className="format-note">{note}</aside>}</div>; }

function TutorDashboard({ state, navigate, refresh, notify }: { state: InitialState; navigate: (v: View) => void; refresh: () => Promise<void>; notify: (n: Notice) => void }) {
  const [importOpen, setImportOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<TrackingReportSummary | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<number | null>(null);
  const reports = useMemo(() => {
    return state.trackingReports.map(report => ({ ...report, course: report.courseLevel, deliveries: state.imports.filter(delivery => delivery.reportId === report.id) })).sort((a, b) => {
      const courseOrder = state.courses.findIndex(course => course.id === a.courseLevel) - state.courses.findIndex(course => course.id === b.courseLevel);
      return courseOrder || TRIMESTERS.indexOf(a.trimester) - TRIMESTERS.indexOf(b.trimester) || a.sequence - b.sequence;
    });
  }, [state.courses, state.imports, state.trackingReports]);
  const deleteReport = async () => {
    if (!reportToDelete) return;
    await window.fullSeguiment.deleteTrackingReport(reportToDelete.id);
    await refresh(); notify({ type: 'success', text: tr('reportDeleted') });
  };
  const copyReport = async (report: TrackingReportSummary) => {
    await window.fullSeguiment.copyTrackingReport(report.id);
    await refresh(); notify({ type: 'success', text: tr('reportCopied') });
  };
  const generateReport = async (reportId: number) => {
    setGeneratingReportId(reportId);
    try {
      const result = await window.fullSeguiment.exportTrackingReports(reportId);
      if (result.ok) notify({ type: 'success', text: tr('reportsExportedWithCombined', { count: result.count ?? 0 }) });
      else if (result.code !== 'CANCELLED') notify({ type: 'error', text: result.code === 'NO_IMPORTED_DELIVERIES' ? tr('noImportedDeliveries') : localizedError(result.error, 'importError') });
    } finally { setGeneratingReportId(null); }
  };
  const readyReports = reports.filter(report => trackingProgress(state, report.course, report.deliveries, report.id).complete).length;
  const reportGroups = state.courses.map(course => {
    const courseReports = reports.filter(report => report.course === course.id);
    return { course, reports: courseReports, ready: courseReports.filter(report => trackingProgress(state, report.course, report.deliveries, report.id).complete).length };
  }).filter(group => group.reports.length > 0);
  return <>
    <PageHeader eyebrow={tr('tutorSpace')} title={tr('myTrackingReports')} subtitle={tr('trackingStatusHelp')} action={<button className="primary header-icon-action" title={tr('importDeliveries')} aria-label={tr('importDeliveries')} onClick={() => setImportOpen(true)}><Icon name="upload" /></button>} />
    <section className="teacher-summary" aria-label={tr('summary')}><div className="teacher-summary-items"><article><span><Icon name="sheet" /></span><div><strong>{reports.length}</strong><small>{tr('reportsCreated')}</small></div></article><article className="ready"><span><Icon name="pdf" /></span><div><strong>{readyReports}</strong><small>{tr('readyToGenerate')}</small></div></article></div></section>
    {reports.length === 0 ? <Empty icon="sheet" title={tr('noTrackingReports')} text={tr('noTrackingReportsHelp')} /> : <div className="course-list tutor-report-list">{reportGroups.map(group => <section className="course-group" key={group.course.id}><div className="course-title"><span>{group.course.name}</span><small className={group.ready === group.reports.length ? 'all-complete' : ''}>{group.ready}/{group.reports.length} {tr('complete').toLocaleLowerCase()}</small></div>{TRIMESTERS.map(trimester => {
      const trimesterReports = group.reports.filter(report => report.trimester === trimester);
      if (!trimesterReports.length) return null;
      const latestReportId = trimesterReports[trimesterReports.length - 1].id;
      return <div className="trimester-block" key={trimester}><h3>{trimesterUi(trimester)}</h3><div className="sheet-cards tutor-report-rows">{trimesterReports.map(report => {
        const progress = trackingProgress(state, report.course, report.deliveries, report.id); const comments = tutorCommentProgress(state, report.id, report.course);
        const ready = progress.complete;
        const canDelete = report.id === latestReportId;
        return <article className={`sheet-card tutor-report-card tutor-item-card dashboard-item-card ${ready ? 'sheet-complete' : ''}`} key={report.id}><button className="sheet-open-button" onClick={() => navigate({ page: 'tutor-report', reportId: report.id })}><span className="subject-monogram"><Icon name="sheet" /></span><span className="sheet-card-copy"><strong>{reportUi(report.sequence)}</strong><small>{tr('updated')} {formatRelative(report.updatedAt)}</small></span><span className="assessment-counts"><b>{progress.receivedCount}/{progress.total} {tr('subjectsReceived')}</b><b>{comments.count}/{comments.total} {tr('tutorComments')}</b></span><span className={`subject-completion ${ready ? 'complete' : 'incomplete'}`}>{ready && <Icon name="check" size={14} />}{ready ? tr('complete') : tr('inProgress')}</span></button><div className="report-card-actions"><button className="icon-button sheet-card-icon-action sheet-export-button" disabled={!ready || generatingReportId !== null} aria-busy={generatingReportId === report.id} title={!ready ? tr('reportIncomplete') : tr('generateTrackingSheets')} aria-label={`${tr('generateTrackingSheets')}: ${reportUi(report.sequence)}`} onClick={() => void generateReport(report.id)}><Icon name="pdf" /></button><button className="icon-button sheet-card-icon-action" disabled={report.id !== latestReportId} title={tr('copyReport')} aria-label={`${tr('copyReport')}: ${reportUi(report.sequence)}`} onClick={() => void copyReport(report)}><Icon name="copy" /></button><button className="icon-button danger sheet-card-icon-action sheet-delete-button" disabled={!canDelete} title={canDelete ? tr('delete') : tr('readOnly')} aria-label={`${canDelete ? tr('delete') : tr('readOnly')}: ${courseName(state, report.course)} · ${trimesterUi(report.trimester)} · ${reportUi(report.sequence)}`} onClick={() => setReportToDelete(report)}><Icon name="trash" /></button></div></article>;
      })}</div></div>;
    })}</section>)}</div>}
    {generatingReportId !== null && <ReportGenerationOverlay language={state.language} />}
    {importOpen && <ImportModal close={() => setImportOpen(false)} refresh={refresh} notify={notify} />}
    {reportToDelete && <ConfirmDeleteModal title={tr('deleteReportTitle')} question={tr('deleteReportQuestion')} identifier={`${courseName(state, reportToDelete.courseLevel)} · ${trimesterUi(reportToDelete.trimester)} · ${reportUi(reportToDelete.sequence)}`} note={tr('deleteReportNote')} confirmationText={confirmationWord(reportUi(reportToDelete.sequence))} confirmationPlaceholder={confirmationWord(reportUi(reportToDelete.sequence))} close={() => setReportToDelete(null)} confirm={deleteReport} />}
  </>;
}

function TutorReportPage({ state, reportId, navigate, refresh, notify }: { state: InitialState; reportId: number; navigate: (v: View) => void; refresh: () => Promise<void>; notify: (n: Notice) => void }) {
  const [tutorObservations, setTutorObservations] = useState(state.tutorObservations);
  const [tutorCellsToClear, setTutorCellsToClear] = useState<(() => Promise<void>) | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deliveryToDelete, setDeliveryToDelete] = useState<ImportedWorksheetSummary | null>(null);
  const [subjectToExclude, setSubjectToExclude] = useState<string | null>(null);
  const report = state.trackingReports.find(item => item.id === reportId);
  if (!report) return <Empty icon="sheet" title={tr('noTrackingReports')} text={tr('noTrackingReportsHelp')} />;
  const course = report.courseLevel; const trimester = report.trimester;
  const latestReportId = state.trackingReports.filter(item => item.courseLevel === course && item.trimester === trimester).reduce((latestId, item) => item.sequence > (state.trackingReports.find(candidate => candidate.id === latestId)?.sequence ?? -1) ? item.id : latestId, report.id);
  const readOnly = report.id !== latestReportId;
  const received = state.imports.filter(item => item.reportId === reportId);
  const students = state.students.filter(student => student.courseLevel === course).sort((a, b) => a.sortOrder - b.sortOrder);
  const subjects = courseSubjects(state, course); const progress = trackingProgress(state, course, received, reportId); const comments = tutorCommentProgress(state, reportId, course); const complete = progress.complete;
  const deleteDelivery = async () => { if (!deliveryToDelete) return; await window.fullSeguiment.deleteImportedWorksheet(deliveryToDelete.id); await refresh(); if (received.length === 1) navigate({ page: 'dashboard' }); notify({ type: 'success', text: tr('deliveryDeleted') }); };
  const updateDeliveryBlocking = async (delivery: ImportedWorksheetSummary, isBlocking: boolean) => {
    const updated = await window.fullSeguiment.setImportedWorksheetBlocking(delivery.id, isBlocking);
    await refresh();
    if (!updated.isBlocking) notify({ type: 'success', text: tr('deliveryExcludedSuccess') });
  };
  const requestDeliveryBlockingChange = (delivery: ImportedWorksheetSummary) => {
    if (delivery.isBlocking) setSubjectToExclude(delivery.subject);
    else void updateDeliveryBlocking(delivery, true);
  };
  const updateMissingSubjectExclusion = async (subject: string, excluded: boolean) => {
    await window.fullSeguiment.setReportSubjectExcluded(reportId, subject, excluded);
    await refresh();
    if (excluded) notify({ type: 'success', text: tr('deliveryExcludedSuccess') });
  };
  const renderSubjectStatus = (subject: string) => {
    const item = received.find(delivery => delivery.subject === subject);
    const subjectReady = Boolean(item && !item.isStale);
    const excluded = item?.isBlocking === false || (!item && state.reportSubjectExclusions.some(exclusion => exclusion.reportId === reportId && exclusion.subject === subject));
    return <div className={`subject-status-item tutor-item-card ${excluded ? 'excluded' : ''}`} key={subject}>
      <button className={`subject-status-main ${subjectReady ? 'received' : ''} ${excluded ? 'excluded' : ''}`} disabled={!item} title={item ? tr('viewDelivery') : tr('pending')} onClick={() => item && navigate({ page: 'imported', id: item.id })}>
        <span className="status-icon"><Icon name={subjectReady ? 'check' : 'x'} /></span><strong>{subjectUi(subject)}</strong>{item ? <small><span className="delivery-teacher-name">{item.teacherFirstName} {item.teacherLastName}</span><span className="delivery-generated-date">{deliveryGeneratedLabel(state.language)} · <time dateTime={item.exportedAt}>{formatDate(item.exportedAt)}</time></span>{item.isStale && <span className="delivery-excluded-label">{deliveryRosterInstruction[getActiveLanguage()]}</span>}</small> : <small>{tr('pending')}</small>}
      </button>
      <button className={`icon-button sheet-card-icon-action delivery-blocking-toggle ${excluded ? 'is-excluded' : 'is-blocking'}`} disabled={readOnly} title={readOnly ? tr('readOnly') : excluded ? tr('includeDelivery') : tr('excludeDelivery')} aria-label={`${tr(readOnly ? 'readOnly' : excluded ? 'includeDelivery' : 'excludeDelivery')}: ${subjectUi(subject)}`} onClick={() => !readOnly && (item ? requestDeliveryBlockingChange(item) : excluded ? void updateMissingSubjectExclusion(subject, false) : setSubjectToExclude(subject))}><Icon name={excluded ? 'x' : 'check'} /></button>
      <button className="icon-button sheet-card-icon-action delivery-view" disabled={!item} title={item ? tr('viewDelivery') : tr('pending')} aria-label={`${tr('viewDelivery')}: ${subjectUi(subject)}`} onClick={() => item && navigate({ page: 'imported', id: item.id })}><Icon name="view" /></button>
      <button className="icon-button danger sheet-card-icon-action delivery-delete" disabled={!item || readOnly} title={item ? tr(readOnly ? 'readOnly' : 'deleteDelivery') : tr('pending')} aria-label={`${tr(readOnly ? 'readOnly' : 'deleteDelivery')}: ${subjectUi(subject)}`} onClick={() => item && !readOnly && setDeliveryToDelete(item)}><Icon name="trash" /></button>
    </div>;
  };
  const generateReports = async () => {
    setGenerating(true);
    try {
      const result = await window.fullSeguiment.exportTrackingReports(reportId);
      if (result.ok) notify({ type: 'success', text: tr('reportsExportedWithCombined', { count: result.count ?? 0 }) });
      else if (result.code !== 'CANCELLED') notify({ type: 'error', text: result.code === 'NO_IMPORTED_DELIVERIES' ? tr('noImportedDeliveries') : localizedError(result.error, 'importError') });
    } finally { setGenerating(false); }
  };
  return <>
    <div className="sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'dashboard' })}><Icon name="back" /> {tr('backSummary')}</button></div>
    <PageHeader eyebrow={tr('myTrackingReports')} title={`${courseName(state, course)} · ${trimesterUi(trimester)} · ${reportUi(report.sequence)}`} subtitle={tr('trackingStatusHelp')} action={<button className="primary header-icon-action" disabled={readOnly} title={readOnly ? tr('readOnly') : tr('importDeliveries')} aria-label={readOnly ? tr('readOnly') : tr('importDeliveries')} onClick={() => setImportOpen(true)}><Icon name="upload" /></button>} />
    <div className="filters tutor-report-progress"><div className="progress-summary"><strong>{progress.receivedCount}/{progress.total} {tr('subjectsReceived')} · {comments.count}/{comments.total} {tr('tutorComments')}</strong><div><i style={{ width: `${progress.total ? progress.receivedCount / progress.total * 100 : 0}%` }} /></div></div></div>
    <section className="status-panel"><div className="status-heading"><div><h2>{reportUi(report.sequence)}</h2><p>{tr('teachingTeamStatus')}</p></div><span className={complete ? 'complete' : 'pending'}>{complete ? tr('complete') : tr('inProgress')}</span></div><div className="subject-status-list">{subjects.map(renderSubjectStatus)}</div><section className="tutor-observations-panel"><header><h3>{tr('tutorObservations')}</h3><p>{tr('tutorObservationsHelp')}</p></header><TutorObservationGrid key={reportId} reportId={reportId} students={students} values={tutorObservations} readOnly={readOnly} onValueChange={updates => setTutorObservations(current => ({ ...current, ...updates }))} requestClear={clear => setTutorCellsToClear(() => clear)} /></section><div className="status-generate"><button type="button" className="primary tutor-generate-button" disabled={!complete || generating} aria-busy={generating} title={!complete ? tr('reportIncomplete') : tr('generateTrackingSheets')} onClick={() => void generateReports()}><Icon name="pdf" /> {tr('generateTrackingSheets')}</button></div></section>
    {generating && <ReportGenerationOverlay language={state.language} />}
    {tutorCellsToClear && <ConfirmDeleteModal title={tr('clearSelectionTitle')} question={tr('clearSelectionQuestion')} note={tr('clearSelectionNote')} close={() => setTutorCellsToClear(null)} confirm={tutorCellsToClear} />}
    {importOpen && <ImportModal course={courseName(state, course)} trimester={trimesterOptionUi(trimester)} close={() => setImportOpen(false)} refresh={refresh} notify={notify} />}
    {deliveryToDelete && <ConfirmDeleteModal title={tr('deleteDeliveryTitle')} question={tr('deleteDeliveryQuestion')} identifier={subjectUi(deliveryToDelete.subject)} note={tr('deleteDeliveryNote')} confirmationText={confirmationWord(subjectUi(deliveryToDelete.subject))} confirmationPlaceholder={confirmationWord(subjectUi(deliveryToDelete.subject))} close={() => setDeliveryToDelete(null)} confirm={deleteDelivery} />}
    {subjectToExclude && <ConfirmExcludeModal subject={subjectToExclude} close={() => setSubjectToExclude(null)} confirm={() => { const delivery = received.find(item => item.subject === subjectToExclude); return delivery ? updateDeliveryBlocking(delivery, false) : updateMissingSubjectExclusion(subjectToExclude, true); }} />}
  </>;
}

function ImportModal({ course, trimester, close, refresh, notify }: { course?: string; trimester?: string; close: () => void; refresh: () => Promise<void>; notify: (n: Notice) => void }) {
  const [results, setResults] = useState<ImportAnalysis[]>([]); const [busy, setBusy] = useState(false); const [dragging, setDragging] = useState(false);
  const analyze = async (paths: string[]) => { if (!paths.length) return; setBusy(true); setResults(await window.fullSeguiment.analyzeImports(paths)); setBusy(false); };
  const choose = async () => analyze(await window.fullSeguiment.chooseImportFiles());
  const commit = async (result: Extract<ImportAnalysis, { ok: true }>) => {
    const saved = await window.fullSeguiment.commitImport(result.data);
    if (saved.ok) { await refresh(); setResults(current => current.filter(item => item !== result)); notify({ type: 'success', text: saved.replaced ? tr('replaced') : tr('importOk') }); }
    else {
      const rosterDetails = saved.missingInFile || saved.extraInFile
        ? [saved.missingInFile?.length ? `${tr('missingTutor')}: ${saved.missingInFile.join(', ')}` : '', saved.extraInFile?.length ? `${tr('missingFile')}: ${saved.extraInFile.join(', ')}` : ''].filter(Boolean).join(' · ')
        : '';
      notify({ type: 'error', text: rosterDetails ? `${deliveryRosterInstruction[getActiveLanguage()]} · ${rosterDetails}` : localizedError(saved.error, 'importError') });
    }
  };
  const commitAll = async () => { for (const result of results) if (result.ok) await commit(result); };
  return <Modal title={tr('importDeliveries')} subtitle={course && trimester ? `${tr('course')}: ${course} · ${tr('trimester')}: ${trimester}` : tr('importHelp')} close={close} className="import-modal">
    <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void analyze(Array.from(e.dataTransfer.files).map(file => window.fullSeguiment.getDroppedFilePath(file))); }}><span><Icon name="upload" size={30} /></span><h2>{tr('dropFiles')}</h2><p>{tr('multiFiles')}</p><button className="secondary" onClick={() => void choose()}>{tr('selectFiles')}</button><small>{tr('onlyFull')}</small></div>
    {busy && <div className="analyzing"><div className="spinner" /> {tr('validating')}</div>}
    {results.length > 0 && <section className="import-results"><div className="results-heading"><div><h2>{tr('validationResult')}</h2><p>{tr('prepared', { ok: results.filter(r => r.ok).length, bad: results.filter(r => !r.ok).length })}</p></div>{results.filter(r => r.ok).length > 1 && <button className="primary" onClick={() => void commitAll()}>{tr('importValid')}</button>}</div>{results.map((result, index) => <article className={`result-card ${result.ok ? 'valid' : 'invalid'}`} key={`${result.path}-${index}`}><span className="result-icon"><Icon name={result.ok ? 'check' : 'x'} /></span><div>{result.ok ? <><strong>{result.data.course.name} · {trimesterUi(result.data.trimester.id)} · {result.data.subject.name}</strong><p>{tr('teacherLabel')} {result.data.teacher.firstName} {result.data.teacher.lastName} · {result.data.students.length} · {result.data.columns.length}</p>{result.duplicate && <span className="duplicate-tag">{tr('duplicateReplace')}</span>}</> : <><strong>{tr('cannotImport')}</strong><p>{localizedError(result.error, 'importError')}</p>{result.missingInFile && result.missingInFile.length > 0 && <div className="difference"><b>{tr('missingTutor')}</b>{result.missingInFile.map((name, i) => <span key={`${name}-${i}`}>{name}</span>)}</div>}{result.extraInFile && result.extraInFile.length > 0 && <div className="difference"><b>{tr('missingFile')}</b>{result.extraInFile.map((name, i) => <span key={`${name}-${i}`}>{name}</span>)}</div>}</>}</div>{result.ok && <button className="primary compact" onClick={() => void commit(result)}>{result.duplicate ? tr('importReplace') : tr('importAction')}</button>}</article>)}</section>}
  </Modal>;
}

function ImportedPage({ id, navigate, state }: { id: number; navigate: (v: View) => void; state: InitialState }) {
  const [item, setItem] = useState<ImportedWorksheetDetail | null>(null);
  useEffect(() => { void window.fullSeguiment.getImportedWorksheet(id).then(setItem); }, [id]);
  if (!item) return <div className="page-loader"><div className="spinner" /></div>;
  const gradeMode = item.payload.subject.gradeMode ?? 'NUMERIC';
  return <><div className="sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'tutor-report', reportId: item.reportId })}><Icon name="back" /> {tr('backSummary')}</button><span className="readonly-tag">{tr('readOnly')}</span></div><PageHeader eyebrow={`${courseName(state, item.courseLevel)} · ${trimesterUi(item.trimester)}`} title={subjectUi(item.subject)} subtitle={`${tr('teacherLabel')} ${item.teacherFirstName} ${item.teacherLastName} · ${deliveryGeneratedLabel(state.language)} ${formatDate(item.exportedAt)} · ${tr('imported')} ${formatDate(item.importedAt)}`} />
    <div className="table-wrap readonly imported-delivery-table"><table className="data-table"><thead><tr><th className="student-column">{tr('student')}</th>{item.payload.columns.map(column => <th key={column.id}><span>{column.name}</span><small>{column.kind === 'EXAM' ? tr('exam') : tr('continuous')} · {formatDateOnly(column.assessmentDate ?? '')}</small></th>)}</tr></thead><tbody>{item.isBlocking ? item.payload.students.map((student, index) => <tr className={student.enabled === false ? 'student-disabled' : ''} key={`${student.name}-${index}`}><td className="student-name"><span>{index + 1}</span>{student.name}{student.enabled === false && <em>{tr('notEnrolled')}</em>}</td>{item.payload.columns.map(column => { const notApplicable = student.applicability?.[column.id] === 'NOT_APPLICABLE'; const grade = notApplicable ? '' : student.values[column.id] ?? ''; const observation = student.observations?.[column.id] ?? ''; return <td key={column.id}><div className="imported-result-cell"><strong className={`imported-grade ${notApplicable ? 'neutral' : importedGradeTone(grade, gradeMode, state.centerConfiguration.grades, state.centerConfiguration.notEvaluatedValue)}`}>{notApplicable ? 'N/A' : grade || '—'}</strong><p>{observation || '—'}</p></div></td>; })}</tr>) : <tr><td className="imported-delivery-excluded" colSpan={item.payload.columns.length + 1}>{tr('deliveryExcludedNotice')}</td></tr>}</tbody></table></div>
  </>;
}

function Empty({ icon, title, text, action }: { icon: Parameters<typeof Icon>[0]['name']; title: string; text: string; action?: React.ReactNode }) { return <div className="empty"><span><Icon name={icon} size={32} /></span><h2>{title}</h2><p>{text}</p>{action}</div>; }
function ReportGenerationOverlay({ language }: { language: AppLanguage }) {
  const overlay = useRef<HTMLDivElement>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setMessageIndex(index => (index + 1) % 4), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div ref={overlay} className="report-generation-overlay" tabIndex={-1} role="status" aria-live="polite" aria-busy="true" onKeyDown={event => { event.preventDefault(); event.stopPropagation(); }}>
    <span className="report-generation-spinner" aria-hidden="true" />
    <p>{reportGenerationLabel(messageIndex, language)}</p>
  </div>;
}
function Modal({ title, subtitle, close, children, className = '' }: { title: string; subtitle: string; close: () => void; children: React.ReactNode; className?: string }) { return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div className={`modal ${className}`}><button className="modal-close" onClick={close}><Icon name="x" /></button><h2>{title}</h2><p>{subtitle}</p><div className="modal-body">{children}</div></div></div>; }

const normalizeConfirmation = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const confirmationWord = (value: string) => normalizeConfirmation(value).split(/\s+/)[0] ?? '';

function ConfirmDeleteModal({ title, question, identifier, note, confirmationText, confirmationPlaceholder, confirmLabel, close, confirm }: { title: string; question: string; identifier?: string; note?: string; confirmationText?: string; confirmationPlaceholder?: string; confirmLabel?: string; close: () => void; confirm: () => void | boolean | Promise<void | boolean> }) {
  const [busy, setBusy] = useState(false); const [typed, setTyped] = useState('');
  const matches = !confirmationText || normalizeConfirmation(typed) === normalizeConfirmation(confirmationText);
  const accept = async () => { if (!matches) return; setBusy(true); try { if (await confirm() !== false) close(); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) close(); }}><div className="modal confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-question"><h2 id="confirm-delete-title">{title}</h2><p id="confirm-delete-question" className="confirm-delete-message">{question}</p>{identifier && <div className="confirm-delete-identifier">{identifier}</div>}{confirmationText && <label className="delete-confirmation-input">{tr('deleteConfirmationPrompt', { subject: confirmationText })}<input autoFocus value={typed} disabled={busy} placeholder={confirmationPlaceholder ?? tr('deleteConfirmationPlaceholder')} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches) void accept(); }} /></label>}{note && <aside className="confirm-delete-note">{note}</aside>}<div className="modal-actions"><button className="secondary" autoFocus={!confirmationText} disabled={busy} onClick={close}>{tr('cancel')}</button><button className="danger-confirm" disabled={busy || !matches} onClick={() => void accept()}>{confirmLabel ?? tr('confirmDelete')}</button></div></div></div>;
}

function ConfirmExcludeModal({ subject, close, confirm }: { subject: string; close: () => void; confirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false); const [typed, setTyped] = useState(''); const [error, setError] = useState('');
  const displaySubject = subjectUi(subject);
  const confirmationText = confirmationWord(displaySubject);
  const matches = normalizeConfirmation(typed) === confirmationText;
  const accept = async () => {
    if (!matches) return;
    setBusy(true); setError('');
    try { await confirm(); close(); }
    catch { setError(tr('excludeDeliveryError')); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) close(); }}><div className="modal confirm-delete-modal confirm-exclude-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-exclude-title" aria-describedby="confirm-exclude-message"><h2 id="confirm-exclude-title">{tr('excludeDeliveryTitle')}</h2><p id="confirm-exclude-message" className="confirm-delete-message">{tr('excludeDeliveryQuestion')}</p><div className="confirm-delete-identifier">{displaySubject}</div><label className="delete-confirmation-input">{tr('excludeConfirmationPrompt', { subject: confirmationText })}<input autoFocus value={typed} disabled={busy} placeholder={confirmationText} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches) void accept(); }} /></label>{error && <div className="inline-error"><Icon name="x" />{error}</div>}<aside className="confirm-delete-note">{tr('excludeDeliveryNote')}</aside><div className="modal-actions"><button className="secondary" disabled={busy} onClick={close}>{tr('cancel')}</button><button className="exclude-confirm" disabled={busy || !matches} onClick={() => void accept()}>{tr('confirmExclude')}</button></div></div></div>;
}

function formatDate(value: string) { const locale = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', eu: 'eu-ES', gl: 'gl-ES' }[getActiveLanguage()]; return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function formatDateOnly(value: string) { if (!value) return ''; const locale = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', eu: 'eu-ES', gl: 'gl-ES' }[getActiveLanguage()]; return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(`${value}T00:00:00`)); }
function formatRelative(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000); return days <= 0 ? tr('today') : days === 1 ? tr('yesterday') : tr('daysAgo', { days }); }

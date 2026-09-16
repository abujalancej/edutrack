import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TRIMESTERS, type CourseLevel, type Trimester } from '@shared/catalogs/catalogs';
import { DEFAULT_CENTER_CONFIGURATION } from '@shared/center/center-configuration';
import { isCompleteGradeValue, normalizeGradeValue } from '@shared/grades/grades';
import type { AppLanguage, AppMode, AssessmentKind, GradeMode, ImportedWorksheetDetail, ImportedWorksheetSummary, ImportAnalysis, InitialState, TeacherSex, TrackingReportSummary, WorksheetDetail, WorksheetSummary } from '@shared/types/models';
import { Icon } from './components/Icon';
import { LANGUAGES, LANGUAGE_LABELS, courseUi, getActiveLanguage, reportUi, setActiveLanguage, setActiveTeacherSex, subjectUi, tr, trimesterOptionUi, trimesterUi } from './i18n';
import { subjectMonograms } from './subject-monogram';
import appIcon from './assets/app-icon.png';

type View = { page: 'dashboard' | 'settings' | 'help' } | { page: 'sheet'; id: number } | { page: 'imported'; id: number } | { page: 'tutor-report'; reportId: number };
type Notice = { type: 'success' | 'error'; text: string } | null;
type CellField = 'grade' | 'observation';
type GridSelection = { start: { row: number; column: number }; end: { row: number; column: number } };
const GRID_FIELDS: CellField[] = ['grade', 'observation'];
const importedGradeTone = (value: string, mode: GradeMode) => {
  const normalized = normalizeGradeValue(value);
  if (!normalized) return 'missing';
  if (mode === 'LETTER') return 'recorded';
  if (normalized === '-') return 'special';
  return normalized === 'NP' || Number(value.replace(',', '.')) < 5 ? 'fail' : 'pass';
};
const emptyState: InitialState = { profile: { firstName: '', lastName: '', sex: 'MALE' }, language: 'es', schoolLogo: '', centerConfiguration: DEFAULT_CENTER_CONFIGURATION, courses: [], subjects: [], students: [], worksheets: [], imports: [], trackingReports: [], tutorObservations: {} };
const courseName = (state: InitialState, id: string) => state.courses.find(course => course.id === id)?.name ?? courseUi(id);
const courseSubjects = (state: InitialState, id: string) => state.subjects.filter(subject => subject.courseId === id).sort((a, b) => a.sortOrder - b.sortOrder).map(subject => subject.name);
const configuredSheetName = (state: InitialState, courseId: string, trimester: Trimester, subject: string) => `${courseName(state, courseId)} · ${trimesterUi(trimester)} · ${subjectUi(subject)}`;
const trackingProgress = (state: InitialState, course: CourseLevel, deliveries: ImportedWorksheetSummary[]) => {
  const subjects = courseSubjects(state, course);
  const deliveryFor = (subject: string) => deliveries.find(delivery => delivery.subject === subject);
  const blockingSubjects = subjects.filter(subject => deliveryFor(subject)?.isBlocking !== false);
  const receivedCount = blockingSubjects.filter(subject => Boolean(deliveryFor(subject))).length;
  return { total: blockingSubjects.length, receivedCount, complete: receivedCount > 0 && receivedCount === blockingSubjects.length };
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

  const refresh = useCallback(async () => { const next = await window.fullSeguiment.getInitialState(); setActiveTeacherSex(next.profile.sex); setState(next); }, []);
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
      {view.page === 'sheet' && <WorksheetPage id={view.id} navigate={setView} refresh={refresh} notify={notify} courses={state.courses} worksheets={state.worksheets} profile={state.profile} centerConfiguration={state.centerConfiguration} />}
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
    <div className="mode-switch" role="group" aria-label="Modo de trabajo">
      <button title={tr('teacher')} className={mode === 'teacher' ? 'active' : ''} onClick={() => onMode('teacher')}><Icon name="teacher" /> <span>{tr('teacher')}</span></button>
      <button title={tr('tutor')} className={mode === 'tutor' ? 'active' : ''} onClick={() => onMode('tutor')}><Icon name="tutor" /> <span>{tr('tutor')}</span></button>
    </div>
    <nav>
      <span className="nav-caption">{mode === 'teacher' ? tr('teacherSpace') : tr('tutorSpace')}</span>
      <button title={dashboardLabel} className={view.page === 'dashboard' || view.page === 'sheet' || view.page === 'tutor-report' || view.page === 'imported' ? 'active' : ''} onClick={() => onNavigate({ page: 'dashboard' })}><Icon name={mode === 'teacher' ? 'book' : 'report'} /> <span>{dashboardLabel}</span></button>
    </nav>
    <div className="sidebar-foot"><nav className="sidebar-common"><label className="sidebar-language-row"><Icon name="language" /><span>{tr('language')}</span><select value={language} aria-label={tr('language')} onChange={event => onLanguage(event.target.value as AppLanguage)}>{LANGUAGES.map(item => <option value={item} key={item}>{LANGUAGE_LABELS[item]}</option>)}</select></label><button title={`${tr('dataMenu')}: ${dataComplete ? tr('dataComplete') : tr('dataIncomplete')}`} className={view.page === 'settings' ? 'active' : ''} onClick={() => onNavigate({ page: 'settings' })}><Icon name="database" /> <span>{tr('dataMenu')}</span><i className={`sidebar-data-status ${dataComplete ? 'complete' : 'incomplete'}`} aria-label={dataComplete ? tr('dataComplete') : tr('dataIncomplete')}><Icon name={dataComplete ? 'check' : 'x'} size={14} /></i></button><button title={tr('help')} className={view.page === 'help' ? 'active' : ''} onClick={() => onNavigate({ page: 'help' })}><Icon name="sheet" /> <span>{tr('help')}</span></button></nav><small className="app-credit">EduTrack v1.1.0 by <a href="https://github.com/abujalancej/edutrack" target="_blank" rel="noreferrer">abujalancej</a></small></div>
  </aside>;
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function TeacherDashboard({ state, refresh, navigate, notify }: { state: InitialState; refresh: () => Promise<void>; navigate: (v: View) => void; notify: (n: Notice) => void }) {
  const [creating, setCreating] = useState(false);
  const [sheetToDelete, setSheetToDelete] = useState<WorksheetSummary | null>(null);
  const catalogReady = state.courses.length > 0 && state.subjects.length > 0;
  const completedSheets = state.worksheets.filter(sheet => sheet.isComplete).length;
  const grouped = useMemo(() => state.courses.map(course => ({ course, trimesters: TRIMESTERS.map(trimester => ({ trimester, sheets: state.worksheets.filter(w => w.courseLevel === course.id && w.trimester === trimester) })).filter(x => x.sheets.length) })).filter(x => x.trimesters.length), [state.courses, state.worksheets]);
  const deleteSheet = async (sheet: WorksheetSummary) => {
    await window.fullSeguiment.deleteWorksheet(sheet.id); await refresh(); notify({ type: 'success', text: tr('sheetDeleted') });
  };
  const exportSheet = async (sheet: WorksheetSummary) => {
    const result = await window.fullSeguiment.exportWorksheet(sheet.id);
    if (result.ok) notify({ type: 'success', text: tr('exported') });
    else if (result.code === 'PROFILE_REQUIRED') { notify({ type: 'error', text: tr('profileNeeded') }); navigate({ page: 'settings' }); }
    else if (result.code === 'STUDENTS_REQUIRED') notify({ type: 'error', text: tr('studentsNeeded') });
    else if (result.code === 'INCOMPLETE_WORKSHEET') notify({ type: 'error', text: tr('worksheetIncomplete') });
  };
  return <>
    <PageHeader eyebrow={tr('teacherSpace')} title={tr('mySheets')} subtitle={tr('mySheetsHelp')} action={<button className="primary header-icon-action" title={catalogReady ? tr('newSheet') : tr('configureCenterHelp')} aria-label={tr('newSheet')} disabled={!catalogReady} onClick={() => setCreating(true)}><Icon name="plus" /></button>} />
    <section className="teacher-summary" aria-label={tr('summary')}><div className="teacher-summary-items"><article><span><Icon name="sheet" /></span><div><strong>{state.worksheets.length}</strong><small>{tr('sheetsCreated')}</small></div></article><article className="ready"><span><Icon name="download" /></span><div><strong>{completedSheets}</strong><small>{tr('readyToExport')}</small></div></article></div></section>
    {grouped.length === 0 ? <Empty icon="sheet" title={tr('noSheets')} text={catalogReady ? tr('noSheetsHelp') : tr('configureCenterHelp')} /> :
      <div className="course-list">{grouped.map(group => { const courseSheets = group.trimesters.flatMap(item => item.sheets); const completed = courseSheets.filter(sheet => sheet.isComplete).length; const monograms = subjectMonograms(courseSheets.map(sheet => sheet.subject)); return <section className="course-group" key={group.course.id}><div className="course-title"><span>{group.course.name}</span><small className={completed === courseSheets.length ? 'all-complete' : ''}>{completed}/{courseSheets.length} {tr('complete').toLocaleLowerCase()}</small></div>{group.trimesters.map(t => <div className="trimester-block" key={t.trimester}><h3>{trimesterUi(t.trimester)}</h3><div className="sheet-cards subject-rows">{t.sheets.map(sheet => { const changes = sheet.changeSummary; return <article className={`sheet-card ${sheet.isComplete ? 'sheet-complete' : ''}`} key={sheet.id}><button className="sheet-open-button" onClick={() => navigate({ page: 'sheet', id: sheet.id })}><span className="subject-monogram">{monograms.get(sheet.subject)}</span><span className="sheet-card-copy"><strong>{subjectUi(sheet.subject)}{sheet.isElective && <i className="subject-elective-badge">{tr('elective')}</i>}</strong><small>{tr('updated')} {formatRelative(sheet.updatedAt)}</small>{changes && <span className="worksheet-change-warnings">{changes.addedStudents.length > 0 && <b>{tr('newStudentsWarning', { count: changes.addedStudents.length })}</b>}{changes.removedStudents.length > 0 && <b>{tr('removedStudentsWarning', { count: changes.removedStudents.length })}</b>}{changes.addedAssessments.length > 0 && <b>{tr('newAssessmentsWarning', { count: changes.addedAssessments.length })}</b>}</span>}</span><span className="assessment-counts"><b>{tr('examCount', { count: sheet.examCount })}</b><b>{tr('continuousCount', { count: sheet.continuousAssessmentCount })}</b></span><span className={`subject-completion ${sheet.isComplete ? 'complete' : 'incomplete'}`}>{sheet.isComplete && <Icon name="check" size={14} />}{sheet.isComplete ? tr('complete') : tr('incomplete')}</span></button><button className="icon-button sheet-card-icon-action sheet-export-button" title={sheet.isComplete ? tr('export') : tr('worksheetIncomplete')} aria-label={`${tr('export')}: ${subjectUi(sheet.subject)}`} disabled={!sheet.isComplete} onClick={() => void exportSheet(sheet)}><Icon name="download" /></button><button className="icon-button danger sheet-card-icon-action sheet-delete-button" title={tr('delete')} aria-label={`${tr('delete')}: ${subjectUi(sheet.subject)}`} onClick={() => setSheetToDelete(sheet)}><Icon name="trash" /></button></article>; })}</div></div>)}</section>; })}</div>}
    {creating && <NewWorksheetModal state={state} close={() => setCreating(false)} refresh={refresh} navigate={navigate} />}
    {sheetToDelete && <ConfirmDeleteModal title={tr('deleteSheetTitle')} message={tr('deleteSheet', { sheet: configuredSheetName(state, sheetToDelete.courseLevel, sheetToDelete.trimester, sheetToDelete.subject) })} confirmationText={sheetToDelete.subject} close={() => setSheetToDelete(null)} confirm={() => deleteSheet(sheetToDelete)} />}
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

function WorksheetPage({ id, navigate, refresh, notify, courses, worksheets, profile, centerConfiguration }: { id: number; navigate: (v: View) => void; refresh: () => Promise<void>; notify: (n: Notice) => void; courses: InitialState['courses']; worksheets: InitialState['worksheets']; profile: InitialState['profile']; centerConfiguration: InitialState['centerConfiguration'] }) {
  const [sheet, setSheet] = useState<WorksheetDetail | null>(null); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<WorksheetDetail['columns'][number] | null>(null);
  const [assessmentToDelete, setAssessmentToDelete] = useState<WorksheetDetail['columns'][number] | null>(null); const [confirmingSelectionClear, setConfirmingSelectionClear] = useState(false); const [copying, setCopying] = useState(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState<number | null>(null);
  const [managingElectiveStudents, setManagingElectiveStudents] = useState(false);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const load = useCallback(() => window.fullSeguiment.getWorksheet(id).then(setSheet), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!sheet) return <div className="page-loader"><div className="spinner" /></div>;
  const saveAssessment = async (input: { kind: AssessmentKind; name: string; assessmentDate: string }, columnId?: number) => {
    if (columnId) await window.fullSeguiment.updateAssessment(columnId, input);
    else {
      const updated = await window.fullSeguiment.addAssessment({ worksheetId: id, ...input });
      setActiveAssessmentId(updated.columns.at(-1)?.id ?? null); setSelection(null);
      setSheet(updated);
    }
    setAdding(false); setEditing(null); await load(); await refresh();
  };
  const removeColumn = async (columnId: number) => { await window.fullSeguiment.deleteColumn(columnId); if (activeAssessmentId === columnId) setActiveAssessmentId(null); setSelection(null); await load(); await refresh(); };
  const copyWorksheet = async (trimester: Trimester) => { const copy = await window.fullSeguiment.copyWorksheet(id, trimester); await refresh(); setCopying(false); notify({ type: 'success', text: tr('copySheetCreated') }); navigate({ page: 'sheet', id: copy.id }); };
  const exportSheet = async () => { const result = await window.fullSeguiment.exportWorksheet(id); if (result.ok) notify({ type: 'success', text: tr('exported') }); else if (result.code === 'PROFILE_REQUIRED') { notify({ type: 'error', text: tr('profileNeeded') }); navigate({ page: 'settings' }); } else if (result.code === 'STUDENTS_REQUIRED') notify({ type: 'error', text: tr('studentsNeeded') }); else if (result.code === 'INCOMPLETE_WORKSHEET') notify({ type: 'error', text: tr('worksheetIncomplete') }); };
  const activeAssessment = sheet.columns.find(column => column.id === activeAssessmentId) ?? sheet.columns[0] ?? null;
  const disabledStudentIds = new Set(sheet.disabledStudentIds ?? []);
  const activeStudents = sheet.students.filter(student => !disabledStudentIds.has(student.id));
  const activeIndex = activeAssessment ? sheet.columns.findIndex(column => column.id === activeAssessment.id) : -1;
  const activeComplete = Boolean(activeAssessment && activeStudents.length > 0 && activeStudents.every(student => isCompleteGradeValue(sheet.values[`${student.id}:${activeAssessment.id}`] ?? '', sheet.gradeMode, centerConfiguration.grades)));
  const exportReady = Boolean(profile.firstName.trim() && profile.lastName.trim() && activeStudents.length && sheet.columns.length && activeStudents.every(student => sheet.columns.every(column => isCompleteGradeValue(sheet.values[`${student.id}:${column.id}`] ?? '', sheet.gradeMode, centerConfiguration.grades))));
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
      const value = field === 'grade' ? sheet.gradeMode === 'NUMERIC' ? normalizeGradeValue(update.value) : update.value.toLocaleUpperCase().slice(0, 12) : update.value;
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
    if (!normalized) return;
    event.preventDefault();
    const pasted = event.clipboardData.getData('text/plain').replace(/\r/g, '').replace(/\n$/, '').split('\n').map(row => row.split('\t'));
    const updates: Array<{ row: number; column: number; value: string }> = [];
    if (pasted.length === 1 && pasted[0].length === 1 && selectedCount > 1) {
      for (let row = normalized.top; row <= normalized.bottom; row++) for (let column = normalized.left; column <= normalized.right; column++) updates.push({ row, column, value: pasted[0][0] });
    } else {
      pasted.forEach((row, rowOffset) => row.forEach((value, columnOffset) => updates.push({ row: normalized.top + rowOffset, column: normalized.left + columnOffset, value })));
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
    if (event.key === 'Tab') { setSelection(null); return; }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && activeStudents.length > 0) {
      event.preventDefault();
      const focusedCell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-grid-row][data-grid-column]') : null;
      const focused = focusedCell ? { row: Number(focusedCell.dataset.gridRow), column: Number(focusedCell.dataset.gridColumn) } : null;
      const start = selection?.start ?? focused ?? { row: 0, column: 0 };
      const end = selection?.end ?? start;
      setSelection({ start, end: { row: event.key === 'ArrowUp' ? 0 : activeStudents.length - 1, column: end.column } });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection({ start: { row: 0, column: 0 }, end: { row: activeStudents.length - 1, column: GRID_FIELDS.length - 1 } });
      return;
    }
    if (event.key === 'Escape') { setSelection(null); return; }
    if (!normalized || !['Delete', 'Backspace'].includes(event.key)) return;
    const editingCell = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (editingCell && selectedCount === 1) return;
    event.preventDefault(); setConfirmingSelectionClear(true);
  };
  const selectCell = (row: number, column: number, extend = false) => setSelection(current => extend && current ? { ...current, end: { row, column } } : { start: { row, column }, end: { row, column } });
  const selectAssessment = (assessmentId: number | null) => { setActiveAssessmentId(assessmentId); setSelection(null); };
  return <>
    <div className="sheet-toolbar compact-sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'dashboard' })}><Icon name="back" /> {tr('back')}</button><div className="compact-sheet-title"><span>{courses.find(course => course.id === sheet.courseLevel)?.name ?? sheet.courseLevel} · {trimesterUi(sheet.trimester)}</span><strong>{subjectUi(sheet.subject)}{sheet.isElective && <small className="elective-title-tag">{tr('elective')}</small>}</strong></div><div className="toolbar-actions">{sheet.isElective && <button className="secondary elective-students-button" title={tr('manageElectiveStudents')} onClick={() => setManagingElectiveStudents(true)}><Icon name="users" /> {activeStudents.length}/{sheet.students.length}</button>}<button className="secondary" title={tr('copySheet')} onClick={() => setCopying(true)}><Icon name="copy" /> {tr('copySheet')}</button><button className="primary" disabled={!exportReady} title={exportReady ? tr('export') : tr('exportRequirements')} onClick={() => void exportSheet()}><Icon name="download" /> {tr('export')}</button></div></div>
    {sheet.students.length === 0 ? <Empty icon="users" title={tr('noCourseStudents')} text={tr('noCourseStudentsHelp')} action={<button className="primary" onClick={() => navigate({ page: 'settings' })}>{tr('goSettings')}</button>} /> :
      <div className="assessment-workspace">
        <section className="assessment-detail">
          <header className="assessment-compact-header"><label className="assessment-picker"><select aria-label={tr('availableAssessments')} value={activeAssessment?.id ?? ''} disabled={!activeAssessment} onChange={event => selectAssessment(Number(event.target.value))}>{activeAssessment ? sheet.columns.map(column => <option key={column.id} value={column.id}>{column.name} · {formatDateOnly(column.assessmentDate)} | {column.kind === 'EXAM' ? tr('exam') : tr('continuous')}</option>) : <option value="">{tr('noAssessments')}</option>}</select>{activeAssessment && <b className={`assessment-state ${activeComplete ? 'complete' : 'incomplete'}`}>{activeComplete ? tr('complete') : tr('incomplete')}</b>}</label><div className="assessment-actions"><button className="icon-action" title={tr('previous')} disabled={!activeAssessment || activeIndex <= 0} onClick={() => selectAssessment(sheet.columns[activeIndex - 1]?.id ?? null)}><Icon name="back" /></button><button className="icon-action next-assessment" title={tr('next')} disabled={!activeAssessment || activeIndex >= sheet.columns.length - 1} onClick={() => selectAssessment(sheet.columns[activeIndex + 1]?.id ?? null)}>→</button><i className="assessment-action-separator" /><button className="icon-action" title={tr('addAssessment')} onClick={() => setAdding(true)}><Icon name="plus" /></button><button className="icon-action" title={tr('editAssessment')} disabled={!activeAssessment} onClick={() => activeAssessment && setEditing(activeAssessment)}><Icon name="edit" /></button><button className="icon-action danger" title={activeAssessment?.sourceColumnId ? tr('cannotDeleteCopiedAssessment') : tr('deleteAssessment')} disabled={!activeAssessment || Boolean(activeAssessment?.sourceColumnId)} onClick={() => activeAssessment && setAssessmentToDelete(activeAssessment)}><Icon name="trash" /></button></div></header>
          {activeAssessment ? <>
            <div className="table-wrap assessment-table-wrap" tabIndex={0} onCopy={copySelection} onPaste={pasteSelection} onKeyDown={handleGridKeyDown}><table className="data-table assessment-table"><thead><tr><th className="student-column"><span>{tr('student')}</span><small>{sheet.isElective ? tr('electiveStudents') : tr('courseList')}</small></th><th className="grade-column">{tr('grade')}</th><th>{tr('observation')}</th></tr></thead><tbody>{activeStudents.map((student, rowIndex) => {
              const key = `${student.id}:${activeAssessment.id}`; const missingGrade = !isCompleteGradeValue(sheet.values[key] ?? '', sheet.gradeMode, centerConfiguration.grades);
              const selected = (column: number) => Boolean(normalized && rowIndex >= normalized.top && rowIndex <= normalized.bottom && column >= normalized.left && column <= normalized.right);
              const cellEvents = (column: number) => ({ 'data-grid-row': rowIndex, 'data-grid-column': column, onMouseDown: (event: React.MouseEvent) => selectCell(rowIndex, column, event.shiftKey), onMouseEnter: (event: React.MouseEvent) => { if (event.buttons === 1) selectCell(rowIndex, column, true); } });
              return <tr className={missingGrade ? 'row-incomplete' : ''} key={key}><td className="student-name"><span>{rowIndex + 1}</span>{student.fullName}</td><td className={`grade-cell spreadsheet-cell ${missingGrade ? 'grade-incomplete' : ''} ${selected(0) ? 'cell-selected' : ''}`} {...cellEvents(0)}><CellEditor field="grade" gradeMode={sheet.gradeMode} grades={centerConfiguration.grades} worksheetId={id} studentId={student.id} columnId={activeAssessment.id} initialValue={sheet.values[key] ?? ''} label={`${student.fullName}, ${tr('grade')}`} onValueChange={value => updateLocalValue(student.id, 'grade', value)} /></td><td className={`observation-cell spreadsheet-cell ${selected(1) ? 'cell-selected' : ''}`} {...cellEvents(1)}><CellEditor field="observation" gradeMode={sheet.gradeMode} grades={centerConfiguration.grades} worksheetId={id} studentId={student.id} columnId={activeAssessment.id} initialValue={sheet.observations[key] ?? ''} label={`${student.fullName}, ${tr('observation')}`} onValueChange={value => updateLocalValue(student.id, 'observation', value)} /></td></tr>;
            })}</tbody></table></div>
          </> : <div className="assessment-empty-state"><span><Icon name="sheet" size={28} /></span><div><h2>{tr('noAssessments')}</h2><p>{tr('emptyAssessmentHelp')}</p></div></div>}
        </section>
      </div>}
    {adding && <AssessmentModal close={() => setAdding(false)} onSave={input => saveAssessment(input)} />}
    {managingElectiveStudents && <ElectiveStudentsModal sheet={sheet} close={() => setManagingElectiveStudents(false)} save={async enabledStudentIds => { const updated = await window.fullSeguiment.configureElectiveStudents(sheet.id, enabledStudentIds); setSheet(updated); setSelection(null); await refresh(); }} />}
    {editing && <AssessmentModal initial={editing} close={() => setEditing(null)} onSave={input => saveAssessment(input, editing.id)} />}
    {assessmentToDelete && <ConfirmDeleteModal title={tr('deleteAssessmentTitle')} message={tr('deleteColumn', { name: assessmentToDelete.name })} close={() => setAssessmentToDelete(null)} confirm={() => removeColumn(assessmentToDelete.id)} />}
    {confirmingSelectionClear && <ConfirmDeleteModal title={tr('clearSelectionTitle')} message={tr('clearSelectionConfirm')} close={() => setConfirmingSelectionClear(false)} confirm={clearSelection} />}
    {copying && <CopyWorksheetModal subject={sheet.subject} sourceTrimester={sheet.trimester} existingTrimesters={worksheets.filter(item => item.courseLevel === sheet.courseLevel && item.subject === sheet.subject).map(item => item.trimester)} close={() => setCopying(false)} onSave={copyWorksheet} />}
  </>;
}

function CellEditor({ worksheetId, studentId, columnId, initialValue, label, field, gradeMode, grades, onValueChange }: { worksheetId: number; studentId: number; columnId: number; initialValue: string; label: string; field: CellField; gradeMode: GradeMode; grades: InitialState['centerConfiguration']['grades']; onValueChange: (value: string) => void }) {
  const latestValue = useRef(initialValue);
  const timer = useRef<number | null>(null);
  const save = (next: string) => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; void window.fullSeguiment.saveCell(worksheetId, studentId, columnId, field, next); };
  useEffect(() => { latestValue.current = initialValue; }, [initialValue]);
  useEffect(() => () => { if (timer.current !== null) { window.clearTimeout(timer.current); void window.fullSeguiment.saveCell(worksheetId, studentId, columnId, field, latestValue.current); } }, [columnId, field, studentId, worksheetId]);
  const common = { value: initialValue, 'aria-label': label, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const raw = event.target.value; const next = field === 'grade' ? gradeMode === 'NUMERIC' ? normalizeGradeValue(raw) : raw.toLocaleUpperCase().slice(0, 12) : raw; latestValue.current = next; onValueChange(next); if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(next), 350); }, onBlur: () => save(initialValue) };
  const gradeMissing = initialValue.trim() === '';
  const normalizedGrade = normalizeGradeValue(initialValue);
  const numericGrade = Number(initialValue.replace(',', '.')); const validGrade = isCompleteGradeValue(initialValue, gradeMode, grades);
  const gradeClass = gradeMissing ? 'grade-missing' : normalizedGrade === '-' ? 'grade-special' : validGrade && numericGrade >= 5 ? 'grade-pass' : 'grade-fail';
  if (field === 'grade' && gradeMode === 'LETTER') return <><input {...common} className={`grade-letter ${gradeMissing || !validGrade ? 'grade-missing' : ''}`} type="text" list={`letter-grade-options-${worksheetId}`} maxLength={12} spellCheck={false} autoCapitalize="characters" aria-invalid={!validGrade} /><datalist id={`letter-grade-options-${worksheetId}`}>{grades.map(item => <option key={item.grade} value={item.grade} />)}</datalist></>;
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

function AssessmentModal({ initial, close, onSave }: { initial?: WorksheetDetail['columns'][number]; close: () => void; onSave: (input: { kind: AssessmentKind; name: string; assessmentDate: string }) => Promise<void> }) {
  const [kind, setKind] = useState<AssessmentKind>(initial?.kind ?? 'EXAM');
  const [name, setName] = useState(initial?.name ?? '');
  const [assessmentDate, setAssessmentDate] = useState(initial?.assessmentDate || new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState(false);
  const save = async () => { setSubmitted(true); if (!name.trim() || !assessmentDate) return; await onSave({ kind, name, assessmentDate }); };
  return <Modal title={initial ? tr('editAssessment') : tr('newAssessment')} subtitle={tr('assessmentHelp')} close={close}>
    <label>{tr('assessmentType')}<select value={kind} onChange={event => setKind(event.target.value as AssessmentKind)}><option value="EXAM">{tr('exam')}</option><option value="CONTINUOUS_ASSESSMENT">{tr('continuous')}</option></select></label>
    <label>{tr('assessmentDate')}<input className={submitted && !assessmentDate ? 'field-invalid' : ''} aria-invalid={submitted && !assessmentDate} type="date" value={assessmentDate} onChange={event => setAssessmentDate(event.target.value)} />{submitted && !assessmentDate && <small className="field-error">{tr('requiredField')}</small>}</label>
    <label>{tr('assessmentName')}<input className={submitted && !name.trim() ? 'field-invalid' : ''} aria-invalid={submitted && !name.trim()} autoFocus value={name} placeholder={tr('assessmentNamePlaceholder')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} />{submitted && !name.trim() && <small className="field-error">{tr('requiredField')}</small>}</label>
    {submitted && (!name.trim() || !assessmentDate) && <div className="inline-error"><Icon name="x" />{tr('missingRequiredFields')}</div>}
    <div className="modal-actions"><button className="secondary" onClick={close}>{tr('cancel')}</button><button className="primary" onClick={() => void save()}>{initial ? tr('saveChanges') : tr('createAssessment')}</button></div>
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

function Settings({ state, refresh, notify, onProfileChange }: { state: InitialState; refresh: () => Promise<void>; notify: (n: Notice) => void; onProfileChange: (profile: InitialState['profile']) => void }) {
  const [firstName, setFirstName] = useState(state.profile.firstName); const [lastName, setLastName] = useState(state.profile.lastName); const [sex, setSex] = useState<TeacherSex>(state.profile.sex === 'FEMALE' ? 'FEMALE' : 'MALE');
  const [deleteTarget, setDeleteTarget] = useState<'center' | 'logo' | null>(null);
  const [confirmingCenterImport, setConfirmingCenterImport] = useState(false);
  const hasCenterData = Boolean(state.courses.length || state.subjects.length || state.students.length || state.worksheets.length || state.imports.length);
  const latestProfile = useRef({ firstName: state.profile.firstName, lastName: state.profile.lastName, sex: state.profile.sex === 'FEMALE' ? 'FEMALE' as const : 'MALE' as const }); const profileTimer = useRef<number | null>(null); const profileDirty = useRef(false); const profileRevision = useRef(0);
  const persistProfile = useCallback(async (showNotice = true) => { if (profileTimer.current !== null) window.clearTimeout(profileTimer.current); profileTimer.current = null; if (!profileDirty.current) return; const revision = profileRevision.current; const saved = await window.fullSeguiment.saveProfile({ ...latestProfile.current }); if (profileRevision.current !== revision) return; profileDirty.current = false; onProfileChange(saved); if (showNotice) notify({ type: 'success', text: tr('profileSaved') }); }, [notify, onProfileChange]);
  const changeProfile = (field: 'firstName' | 'lastName', value: string) => { if (field === 'firstName') setFirstName(value); else setLastName(value); latestProfile.current = { ...latestProfile.current, [field]: value }; profileDirty.current = true; profileRevision.current += 1; if (profileTimer.current !== null) window.clearTimeout(profileTimer.current); profileTimer.current = window.setTimeout(() => void persistProfile(), 350); };
  const changeSex = async (value: TeacherSex) => { setSex(value); latestProfile.current = { ...latestProfile.current, sex: value }; profileDirty.current = true; profileRevision.current += 1; await persistProfile(); };
  useEffect(() => () => { void persistProfile(false); }, [persistProfile]);
  const loadCenterData = async () => {
    const result = await window.fullSeguiment.importCenterData(); if (result.cancelled) return;
    if (!result.ok) { notify({ type: 'error', text: result.error ?? tr('configurationImportError') }); return; }
    await refresh(); notify({ type: 'success', text: tr('centerDataLoaded', { courses: result.courses?.length ?? 0, subjects: result.subjects?.length ?? 0, students: result.students?.length ?? 0 }) });
  };
  const clearCenterData = async () => { await window.fullSeguiment.clearCenterData(); await refresh(); notify({ type: 'success', text: tr('centerDataDeleted') }); };
  const loadLogo = async () => { const result = await window.fullSeguiment.chooseSchoolLogo(); if (result.cancelled) return; if (!result.ok) { notify({ type: 'error', text: result.error ?? tr('configurationImportError') }); return; } await refresh(); notify({ type: 'success', text: tr('logoLoaded') }); };
  const removeLogo = async () => { await window.fullSeguiment.removeSchoolLogo(); await refresh(); };
  return <>
    <PageHeader eyebrow={tr('localPreferences')} title={tr('settings')} subtitle={tr('settingsHelp')} />
    <section className="panel school-configuration"><div className="panel-heading"><span className="panel-icon"><Icon name="settings" /></span><div><h2>{tr('schoolConfiguration')}</h2><p>{tr('schoolConfigurationHelp')}</p></div></div><div className="configuration-cards">
      <article className="configuration-card"><div className="configuration-card-heading"><span><Icon name="school" /></span><div><h3>{tr('centerData')}</h3></div></div><div className="configuration-status-list"><small className={`configuration-status ${hasCenterData ? 'loaded' : 'missing'}`}>{hasCenterData ? tr('centerDataLoaded', { courses: state.courses.length, subjects: state.subjects.length, students: state.students.length }) : tr('noCenterData')}</small><small className="configuration-status loaded">{state.centerConfiguration.hasAssessmentWeights ? tr('centerAssessmentConfiguration', { exam: state.centerConfiguration.examWeight, continuous: state.centerConfiguration.continuousAssessmentWeight, format: state.centerConfiguration.finalReportGradeMode === 'LETTER' ? tr('letterGrades') : tr('numericGrades') }) : state.centerConfiguration.hasLetterGrades ? tr('letterGradesConfigured') : tr('numericOnlyConfiguration')}</small></div><div className="configuration-actions"><button className="icon-button danger sheet-card-icon-action configuration-delete" title={tr('deleteCenterData')} aria-label={tr('deleteCenterData')} disabled={!hasCenterData} onClick={() => setDeleteTarget('center')}><Icon name="trash" /></button><button className="icon-button sheet-card-icon-action sheet-export-button configuration-action" title={tr('loadCenterData')} aria-label={tr('loadCenterData')} onClick={() => hasCenterData ? setConfirmingCenterImport(true) : void loadCenterData()}><Icon name="upload" /></button></div></article>
      <article className="configuration-card"><div className="configuration-card-heading"><span><Icon name="image" /></span><div><h3>{tr('schoolLogo')}</h3></div></div><div className="logo-state-row"><div className="logo-status-preview"><span className={`configuration-status ${state.schoolLogo ? 'loaded' : 'missing'}`} tabIndex={state.schoolLogo ? 0 : undefined}>{state.schoolLogo ? tr('logoLoadedStatus') : tr('noLogoLoaded')}</span>{state.schoolLogo && <div className="logo-hover-preview" role="tooltip"><img src={state.schoolLogo} alt={tr('schoolLogo')} /></div>}</div></div><div className="configuration-actions"><button className="icon-button danger sheet-card-icon-action configuration-delete" title={tr('removeLogo')} aria-label={tr('removeLogo')} disabled={!state.schoolLogo} onClick={() => setDeleteTarget('logo')}><Icon name="trash" /></button><button className="icon-button sheet-card-icon-action sheet-export-button configuration-action" title={tr('loadLogo')} aria-label={tr('loadLogo')} onClick={() => void loadLogo()}><Icon name="upload" /></button></div></article>
    </div></section>
    <section className="panel teacher-profile-panel"><div className="panel-heading"><span className="panel-icon"><Icon name="teacher" /></span><div><h2>{tr('teacherData')}</h2><p>{tr('teacherDataHelp')}</p></div></div><div className="teacher-profile-fields"><label>{tr('firstName')}<input value={firstName} onChange={e => changeProfile('firstName', e.target.value)} onBlur={() => void persistProfile()} placeholder={tr('yourName')} /></label><label>{tr('lastName')}<input value={lastName} onChange={e => changeProfile('lastName', e.target.value)} onBlur={() => void persistProfile()} placeholder={tr('yourLastName')} /></label><label>{tr('sex')}<select required aria-required="true" value={sex} onChange={event => void changeSex(event.target.value as TeacherSex)}><option value="MALE">{tr('male')}</option><option value="FEMALE">{tr('female')}</option></select></label></div></section>
    {deleteTarget === 'center' && <ConfirmDeleteModal title={tr('deleteCenterDataTitle')} message={tr('deleteCenterDataConfirm')} close={() => setDeleteTarget(null)} confirm={clearCenterData} />}
    {deleteTarget === 'logo' && <ConfirmDeleteModal title={tr('removeLogoTitle')} message={tr('removeLogoConfirm')} close={() => setDeleteTarget(null)} confirm={removeLogo} />}
    {confirmingCenterImport && <ConfirmActionModal title={tr('loadCenterData')} message={tr('replaceCenterDataWarning')} close={() => setConfirmingCenterImport(false)} confirm={loadCenterData} />}
  </>;
}

function HelpPage() {
  const [route, setRoute] = useState<'start' | 'teacher' | 'tutor'>('start');
  const headers = 'Course;Subjects;Students';
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
      {route === 'start' && <section className="help-card help-format-card"><div className="help-card-title"><span><Icon name="sheet" /></span><div><h2>{tr('helpDataFormats')}</h2><p>{tr('helpCenterDataText')}</p></div></div><div className="help-formats"><FormatExample title="CSV" code={`${headers}\n3r ESO;Llengua Catalana|Matemàtiques;Anna Pérez|Marc López\n4t ESO;Llengua Catalana|Tecnologia;Laia García|Pau Soler`} note={tr('helpListSeparator')} /><FormatExample title="JSON" code={'{\n  "courses": [\n    {\n      "name": "3r ESO",\n      "subjects": ["Llengua Catalana", "Matemàtiques"],\n      "students": ["Anna Pérez", "Marc López"]\n    }\n  ]\n}'} note={tr('helpJsonKeysNote')} /><div className="format-example image-format-example"><strong>{tr('imageFile')}</strong><div><b>PNG · JPG · JPEG · WEBP</b></div><aside className="format-note">{tr('helpLogoFormat')}</aside></div></div></section>}
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
      else if (result.code !== 'CANCELLED') notify({ type: 'error', text: result.code === 'NO_IMPORTED_DELIVERIES' ? tr('noImportedDeliveries') : result.error ?? tr('importError') });
    } finally { setGeneratingReportId(null); }
  };
  const readyReports = reports.filter(report => trackingProgress(state, report.course, report.deliveries).complete).length;
  const reportGroups = state.courses.map(course => {
    const courseReports = reports.filter(report => report.course === course.id);
    return { course, reports: courseReports, ready: courseReports.filter(report => trackingProgress(state, report.course, report.deliveries).complete).length };
  }).filter(group => group.reports.length > 0);
  return <>
    <PageHeader eyebrow={tr('tutorSpace')} title={tr('myTrackingReports')} subtitle={tr('trackingStatusHelp')} action={<button className="primary header-icon-action" title={tr('importDeliveries')} aria-label={tr('importDeliveries')} onClick={() => setImportOpen(true)}><Icon name="upload" /></button>} />
    <section className="teacher-summary" aria-label={tr('summary')}><div className="teacher-summary-items"><article><span><Icon name="sheet" /></span><div><strong>{reports.length}</strong><small>{tr('reportsCreated')}</small></div></article><article className="ready"><span><Icon name="pdf" /></span><div><strong>{readyReports}</strong><small>{tr('readyToGenerate')}</small></div></article></div></section>
    {reports.length === 0 ? <Empty icon="sheet" title={tr('noTrackingReports')} text={tr('noTrackingReportsHelp')} /> : <div className="course-list tutor-report-list">{reportGroups.map(group => <section className="course-group" key={group.course.id}><div className="course-title"><span>{group.course.name}</span><small className={group.ready === group.reports.length ? 'all-complete' : ''}>{group.ready}/{group.reports.length} {tr('complete').toLocaleLowerCase()}</small></div>{TRIMESTERS.map(trimester => {
      const trimesterReports = group.reports.filter(report => report.trimester === trimester);
      if (!trimesterReports.length) return null;
      const latestReportId = trimesterReports[trimesterReports.length - 1].id;
      return <div className="trimester-block" key={trimester}><h3>{trimesterUi(trimester)}</h3><div className="sheet-cards tutor-report-rows">{trimesterReports.map(report => {
        const progress = trackingProgress(state, report.course, report.deliveries); const comments = tutorCommentProgress(state, report.id, report.course);
        return <article className="sheet-card tutor-report-card" key={report.id}><button className="sheet-open-button" onClick={() => navigate({ page: 'tutor-report', reportId: report.id })}><span className="subject-monogram"><Icon name="sheet" /></span><span className="sheet-card-copy"><strong>{reportUi(report.sequence)}</strong><small>{tr('updated')} {formatRelative(report.updatedAt)}</small></span><span className="assessment-counts"><b>{progress.receivedCount}/{progress.total} {tr('subjectsReceived')}</b><b>{comments.count}/{comments.total} {tr('tutorComments')}</b></span><span className={`subject-completion ${progress.complete ? 'complete' : 'incomplete'}`}>{progress.complete && <Icon name="check" size={14} />}{progress.complete ? tr('complete') : tr('inProgress')}</span></button><div className="report-card-actions"><button className="icon-button sheet-card-icon-action sheet-export-button" disabled={!progress.complete || generatingReportId === report.id} title={!progress.complete ? tr('reportIncomplete') : tr('generateTrackingSheets')} aria-label={`${tr('generateTrackingSheets')}: ${reportUi(report.sequence)}`} onClick={() => void generateReport(report.id)}><Icon name="pdf" /></button><button className="icon-button sheet-card-icon-action" disabled={report.id !== latestReportId} title={tr('copyReport')} aria-label={`${tr('copyReport')}: ${reportUi(report.sequence)}`} onClick={() => void copyReport(report)}><Icon name="copy" /></button><button className="icon-button danger sheet-card-icon-action sheet-delete-button" disabled={report.id !== latestReportId} title={report.id === latestReportId ? tr('delete') : tr('deleteReportLatestOnly')} aria-label={`${report.id === latestReportId ? tr('delete') : tr('deleteReportLatestOnly')}: ${courseName(state, report.course)} · ${trimesterUi(report.trimester)} · ${reportUi(report.sequence)}`} onClick={() => setReportToDelete(report)}><Icon name="trash" /></button></div></article>;
      })}</div></div>;
    })}</section>)}</div>}
    {importOpen && <ImportModal close={() => setImportOpen(false)} refresh={refresh} notify={notify} />}
    {reportToDelete && <ConfirmDeleteModal title={tr('deleteReportTitle')} message={tr('deleteReportConfirm', { report: `${courseName(state, reportToDelete.courseLevel)} · ${trimesterUi(reportToDelete.trimester)} · ${reportUi(reportToDelete.sequence)}` })} close={() => setReportToDelete(null)} confirm={deleteReport} />}
  </>;
}

function TutorReportPage({ state, reportId, navigate, refresh, notify }: { state: InitialState; reportId: number; navigate: (v: View) => void; refresh: () => Promise<void>; notify: (n: Notice) => void }) {
  const [tutorObservations, setTutorObservations] = useState(state.tutorObservations);
  const [importOpen, setImportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deliveryToDelete, setDeliveryToDelete] = useState<ImportedWorksheetSummary | null>(null);
  const report = state.trackingReports.find(item => item.id === reportId);
  if (!report) return <Empty icon="sheet" title={tr('noTrackingReports')} text={tr('noTrackingReportsHelp')} />;
  const course = report.courseLevel; const trimester = report.trimester;
  const latestReportId = state.trackingReports.filter(item => item.courseLevel === course && item.trimester === trimester).reduce((latestId, item) => item.sequence > (state.trackingReports.find(candidate => candidate.id === latestId)?.sequence ?? -1) ? item.id : latestId, report.id);
  const readOnly = report.id !== latestReportId;
  const received = state.imports.filter(item => item.reportId === reportId);
  const students = state.students.filter(student => student.courseLevel === course).sort((a, b) => a.sortOrder - b.sortOrder);
  const subjects = courseSubjects(state, course); const progress = trackingProgress(state, course, received); const comments = tutorCommentProgress(state, reportId, course); const complete = progress.complete;
  const deleteDelivery = async () => { if (!deliveryToDelete) return; await window.fullSeguiment.deleteImportedWorksheet(deliveryToDelete.id); await refresh(); if (received.length === 1) navigate({ page: 'dashboard' }); notify({ type: 'success', text: tr('deliveryDeleted') }); };
  const toggleDeliveryBlocking = async (delivery: ImportedWorksheetSummary) => {
    const updated = await window.fullSeguiment.setImportedWorksheetBlocking(delivery.id, !delivery.isBlocking);
    await refresh();
    notify({ type: 'success', text: tr(updated.isBlocking ? 'deliveryIncluded' : 'deliveryExcludedSuccess') });
  };
  const renderSubjectStatus = (subject: string) => {
    const item = received.find(delivery => delivery.subject === subject);
    const subjectReady = Boolean(item);
    const excluded = item?.isBlocking === false;
    return <div className={`subject-status-item ${excluded ? 'excluded' : ''}`} key={subject}>
      <button className={`subject-status-main ${subjectReady ? 'received' : ''} ${excluded ? 'excluded' : ''}`} disabled={!item} title={item ? tr('viewDelivery') : tr('pending')} onClick={() => item && navigate({ page: 'imported', id: item.id })}>
        <span className="status-icon"><Icon name={subjectReady ? 'check' : 'x'} /></span><strong>{subjectUi(subject)}</strong>{item ? <small>{item.teacherFirstName} {item.teacherLastName} · {tr(excluded ? 'deliveryExcluded' : 'deliveryBlocking')}</small> : <small>{tr('pending')}</small>}
      </button>
      <button className={`icon-button sheet-card-icon-action delivery-blocking-toggle ${excluded ? 'is-excluded' : 'is-blocking'}`} disabled={!item || readOnly} title={item ? tr(excluded && !readOnly ? 'includeDelivery' : !readOnly ? 'excludeDelivery' : 'readOnly') : tr('pending')} aria-label={`${tr(excluded && !readOnly ? 'includeDelivery' : !readOnly ? 'excludeDelivery' : 'readOnly')}: ${subjectUi(subject)}`} onClick={() => item && !readOnly && void toggleDeliveryBlocking(item)}><Icon name={excluded ? 'x' : 'check'} /></button>
      <button className="icon-button sheet-card-icon-action delivery-view" disabled={!item} title={item ? tr('viewDelivery') : tr('pending')} aria-label={`${tr('viewDelivery')}: ${subjectUi(subject)}`} onClick={() => item && navigate({ page: 'imported', id: item.id })}><Icon name="view" /></button>
      <button className="icon-button danger sheet-card-icon-action delivery-delete" disabled={!item || readOnly} title={item ? tr(readOnly ? 'readOnly' : 'deleteDelivery') : tr('pending')} aria-label={`${tr(readOnly ? 'readOnly' : 'deleteDelivery')}: ${subjectUi(subject)}`} onClick={() => item && !readOnly && setDeliveryToDelete(item)}><Icon name="trash" /></button>
    </div>;
  };
  const generateReports = async () => {
    setGenerating(true);
    try {
      const result = await window.fullSeguiment.exportTrackingReports(reportId);
      if (result.ok) notify({ type: 'success', text: tr('reportsExportedWithCombined', { count: result.count ?? 0 }) });
      else if (result.code !== 'CANCELLED') notify({ type: 'error', text: result.code === 'NO_IMPORTED_DELIVERIES' ? tr('noImportedDeliveries') : result.error ?? tr('importError') });
    } finally { setGenerating(false); }
  };
  return <>
    <div className="sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'dashboard' })}><Icon name="back" /> {tr('backSummary')}</button></div>
    <PageHeader eyebrow={tr('myTrackingReports')} title={`${courseName(state, course)} · ${trimesterUi(trimester)} · ${reportUi(report.sequence)}`} subtitle={tr('trackingStatusHelp')} action={<button className="primary header-icon-action" disabled={readOnly} title={readOnly ? tr('readOnly') : tr('importDeliveries')} aria-label={readOnly ? tr('readOnly') : tr('importDeliveries')} onClick={() => setImportOpen(true)}><Icon name="upload" /></button>} />
    <div className="filters tutor-report-progress"><div className="progress-summary"><strong>{progress.receivedCount}/{progress.total} {tr('subjectsReceived')} · {comments.count}/{comments.total} {tr('tutorComments')}</strong><div><i style={{ width: `${progress.total ? progress.receivedCount / progress.total * 100 : 0}%` }} /></div></div></div>
    <section className="status-panel"><div className="status-heading"><div><h2>{reportUi(report.sequence)}</h2><p>{tr('teachingTeamStatus')}</p></div><span className={complete ? 'complete' : 'pending'}>{complete ? tr('complete') : tr('inProgress')}</span></div><div className="subject-status-list">{subjects.map(renderSubjectStatus)}</div><section className="tutor-observations-panel"><header><h3>{tr('tutorObservations')}</h3><p>{tr('tutorObservationsHelp')}</p></header><div className="table-wrap tutor-observation-table-wrap"><table className="data-table tutor-observation-table"><thead><tr><th className="student-column">{tr('student')}</th><th>{tr('observation')}</th></tr></thead><tbody>{students.map((student, index) => { const key = `${reportId}:${student.id}`; return <tr key={key}><td className="student-name"><span>{index + 1}</span>{student.fullName}</td><td><TutorObservationEditor readOnly={readOnly} reportId={reportId} studentId={student.id} initialValue={tutorObservations[key] ?? ''} label={`${student.fullName}, ${tr('tutorObservations')}`} onValueChange={value => setTutorObservations(current => ({ ...current, [key]: value }))} /></td></tr>; })}</tbody></table>{students.length === 0 && <div className="table-empty">{tr('noCourseStudents')}</div>}</div></section><div className="status-generate"><button type="button" className="primary tutor-generate-button" disabled={!complete || generating} title={!complete ? tr('reportIncomplete') : tr('generateTrackingSheets')} onClick={() => void generateReports()}><Icon name="pdf" /> {tr('generateTrackingSheets')}</button></div></section>
    {importOpen && <ImportModal course={courseName(state, course)} trimester={trimesterOptionUi(trimester)} close={() => setImportOpen(false)} refresh={refresh} notify={notify} />}
    {deliveryToDelete && <ConfirmDeleteModal title={tr('deleteDeliveryTitle')} message={tr('deleteDeliveryConfirm', { subject: subjectUi(deliveryToDelete.subject) })} confirmationText={deliveryToDelete.subject} close={() => setDeliveryToDelete(null)} confirm={deleteDelivery} />}
  </>;
}

function TutorObservationEditor({ reportId, studentId, initialValue, label, onValueChange, readOnly = false }: { reportId: number; studentId: number; initialValue: string; label: string; onValueChange: (value: string) => void; readOnly?: boolean }) {
  const latestValue = useRef(initialValue); const timer = useRef<number | null>(null);
  const save = (value: string) => { if (readOnly) return; if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; void window.fullSeguiment.saveTutorObservation(reportId, studentId, value); };
  useEffect(() => { latestValue.current = initialValue; }, [initialValue]);
  useEffect(() => () => { if (!readOnly && timer.current !== null) { window.clearTimeout(timer.current); void window.fullSeguiment.saveTutorObservation(reportId, studentId, latestValue.current); } }, [readOnly, reportId, studentId]);
  return <textarea className="tutor-observation-editor" rows={1} value={initialValue} readOnly={readOnly} disabled={readOnly} aria-label={label} placeholder={tr('tutorObservationPlaceholder')} onChange={event => { if (readOnly) return; const value = event.target.value.slice(0, 5000); latestValue.current = value; onValueChange(value); if (timer.current !== null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(value), 350); }} onBlur={() => save(initialValue)} />;
}

function ImportModal({ course, trimester, close, refresh, notify }: { course?: string; trimester?: string; close: () => void; refresh: () => Promise<void>; notify: (n: Notice) => void }) {
  const [results, setResults] = useState<ImportAnalysis[]>([]); const [busy, setBusy] = useState(false); const [dragging, setDragging] = useState(false);
  const analyze = async (paths: string[]) => { if (!paths.length) return; setBusy(true); setResults(await window.fullSeguiment.analyzeImports(paths)); setBusy(false); };
  const choose = async () => analyze(await window.fullSeguiment.chooseImportFiles());
  const commit = async (result: Extract<ImportAnalysis, { ok: true }>) => {
    const saved = await window.fullSeguiment.commitImport(result.data);
    if (saved.ok) { await refresh(); setResults(current => current.filter(item => item !== result)); notify({ type: 'success', text: saved.replaced ? tr('replaced') : tr('importOk') }); }
    else notify({ type: 'error', text: saved.error ?? tr('importError') });
  };
  const commitAll = async () => { for (const result of results) if (result.ok) await commit(result); };
  return <Modal title={tr('importDeliveries')} subtitle={course && trimester ? `${tr('course')}: ${course} · ${tr('trimester')}: ${trimester}` : tr('importHelp')} close={close} className="import-modal">
    <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void analyze(Array.from(e.dataTransfer.files).map(file => window.fullSeguiment.getDroppedFilePath(file))); }}><span><Icon name="upload" size={30} /></span><h2>{tr('dropFiles')}</h2><p>{tr('multiFiles')}</p><button className="secondary" onClick={() => void choose()}>{tr('selectFiles')}</button><small>{tr('onlyFull')}</small></div>
    {busy && <div className="analyzing"><div className="spinner" /> {tr('validating')}</div>}
    {results.length > 0 && <section className="import-results"><div className="results-heading"><div><h2>{tr('validationResult')}</h2><p>{tr('prepared', { ok: results.filter(r => r.ok).length, bad: results.filter(r => !r.ok).length })}</p></div>{results.filter(r => r.ok).length > 1 && <button className="primary" onClick={() => void commitAll()}>{tr('importValid')}</button>}</div>{results.map((result, index) => <article className={`result-card ${result.ok ? 'valid' : 'invalid'}`} key={`${result.path}-${index}`}><span className="result-icon"><Icon name={result.ok ? 'check' : 'x'} /></span><div>{result.ok ? <><strong>{result.data.course.name} · {trimesterUi(result.data.trimester.id)} · {result.data.subject.name}</strong><p>{tr('teacherLabel')} {result.data.teacher.firstName} {result.data.teacher.lastName} · {result.data.students.length} · {result.data.columns.length}</p>{result.duplicate && <span className="duplicate-tag">{tr('duplicateReplace')}</span>}</> : <><strong>{tr('cannotImport')}</strong><p>{result.error}</p>{result.missingInFile && result.missingInFile.length > 0 && <div className="difference"><b>{tr('missingTutor')}</b>{result.missingInFile.map((name, i) => <span key={`${name}-${i}`}>{name}</span>)}</div>}{result.extraInFile && result.extraInFile.length > 0 && <div className="difference"><b>{tr('missingFile')}</b>{result.extraInFile.map((name, i) => <span key={`${name}-${i}`}>{name}</span>)}</div>}</>}</div>{result.ok && <button className="primary compact" onClick={() => void commit(result)}>{result.duplicate ? tr('importReplace') : tr('importAction')}</button>}</article>)}</section>}
  </Modal>;
}

function ImportedPage({ id, navigate, state }: { id: number; navigate: (v: View) => void; state: InitialState }) {
  const [item, setItem] = useState<ImportedWorksheetDetail | null>(null);
  useEffect(() => { void window.fullSeguiment.getImportedWorksheet(id).then(setItem); }, [id]);
  if (!item) return <div className="page-loader"><div className="spinner" /></div>;
  const gradeMode = item.payload.subject.gradeMode ?? 'NUMERIC';
  return <><div className="sheet-toolbar"><button className="back-button" onClick={() => navigate({ page: 'tutor-report', reportId: item.reportId })}><Icon name="back" /> {tr('backSummary')}</button><span className="readonly-tag">{tr('readOnly')}</span></div><PageHeader eyebrow={`${courseName(state, item.courseLevel)} · ${trimesterUi(item.trimester)}`} title={subjectUi(item.subject)} subtitle={`${tr('teacherLabel')} ${item.teacherFirstName} ${item.teacherLastName} · ${tr('imported')} ${formatDate(item.importedAt)}`} />
    <div className="table-wrap readonly imported-delivery-table"><table className="data-table"><thead><tr><th className="student-column">{tr('student')}</th>{item.payload.columns.map(column => <th key={column.id}><span>{column.name}</span><small>{column.kind === 'EXAM' ? tr('exam') : tr('continuous')} · {formatDateOnly(column.assessmentDate ?? '')}</small></th>)}</tr></thead><tbody>{item.isBlocking ? item.payload.students.map((student, index) => <tr className={student.enabled === false ? 'student-disabled' : ''} key={`${student.name}-${index}`}><td className="student-name"><span>{index + 1}</span>{student.name}{student.enabled === false && <em>{tr('notEnrolled')}</em>}</td>{item.payload.columns.map(column => { const grade = student.values[column.id] ?? ''; const observation = student.observations?.[column.id] ?? ''; return <td key={column.id}><div className="imported-result-cell"><strong className={`imported-grade ${importedGradeTone(grade, gradeMode)}`}>{grade || '—'}</strong><p>{observation || '—'}</p></div></td>; })}</tr>) : <tr><td className="imported-delivery-excluded" colSpan={item.payload.columns.length + 1}>{tr('deliveryExcludedNotice')}</td></tr>}</tbody></table></div>
  </>;
}

function Empty({ icon, title, text, action }: { icon: Parameters<typeof Icon>[0]['name']; title: string; text: string; action?: React.ReactNode }) { return <div className="empty"><span><Icon name={icon} size={32} /></span><h2>{title}</h2><p>{text}</p>{action}</div>; }
function Modal({ title, subtitle, close, children, className = '' }: { title: string; subtitle: string; close: () => void; children: React.ReactNode; className?: string }) { return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div className={`modal ${className}`}><button className="modal-close" onClick={close}><Icon name="x" /></button><h2>{title}</h2><p>{subtitle}</p><div className="modal-body">{children}</div></div></div>; }

function ConfirmDeleteModal({ title, message, confirmationText, close, confirm }: { title: string; message: string; confirmationText?: string; close: () => void; confirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false); const [typed, setTyped] = useState('');
  const matches = !confirmationText || typed.trim().toLocaleLowerCase() === confirmationText.trim().toLocaleLowerCase();
  const accept = async () => { if (!matches) return; setBusy(true); try { await confirm(); close(); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) close(); }}><div className="modal confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-message"><span className="confirm-delete-icon"><Icon name="trash" size={24} /></span><h2 id="confirm-delete-title">{title}</h2><p id="confirm-delete-message" className="confirm-delete-message">{message}</p>{confirmationText && <label className="delete-confirmation-input">{tr('deleteConfirmationPrompt', { subject: confirmationText })}<input autoFocus value={typed} disabled={busy} placeholder={tr('deleteConfirmationPlaceholder')} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches) void accept(); }} /></label>}<div className="modal-actions"><button className="secondary" autoFocus={!confirmationText} disabled={busy} onClick={close}>{tr('cancel')}</button><button className="danger-confirm" disabled={busy || !matches} onClick={() => void accept()}><Icon name="trash" /> {tr('confirmDelete')}</button></div></div></div>;
}

function ConfirmActionModal({ title, message, close, confirm }: { title: string; message: string; close: () => void; confirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => { setBusy(true); try { await confirm(); close(); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) close(); }}><div className="modal confirm-delete-modal confirm-action-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-message"><span className="confirm-action-icon"><Icon name="upload" size={24} /></span><h2 id="confirm-action-title">{title}</h2><p id="confirm-action-message" className="confirm-delete-message">{message}</p><div className="modal-actions"><button className="secondary" autoFocus disabled={busy} onClick={close}>{tr('cancel')}</button><button className="primary" disabled={busy} onClick={() => void accept()}>{tr('continueAction')}</button></div></div></div>;
}
function formatDate(value: string) { const locale = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', eu: 'eu-ES', gl: 'gl-ES' }[getActiveLanguage()]; return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function formatDateOnly(value: string) { if (!value) return ''; const locale = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', eu: 'eu-ES', gl: 'gl-ES' }[getActiveLanguage()]; return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(`${value}T00:00:00`)); }
function formatRelative(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000); return days <= 0 ? tr('today') : days === 1 ? tr('yesterday') : tr('daysAgo', { days }); }

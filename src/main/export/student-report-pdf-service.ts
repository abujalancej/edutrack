import { APP_VERSION } from '../../shared/version';
import { BrowserWindow } from 'electron';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { letterGradeForNumericValue } from '../../shared/center/center-configuration';
import type { AppLanguage, AssessmentKind, TeacherProfile, TrackingReportsExport } from '../../shared/types/models';

type Labels = {
  title: string; student: string; course: string; trimester: string; report: string; subject: string;
  teacher: string; assessment: string; type: string; date: string; grade: string; observation: string;
  exam: string; continuous: string; tutorObservation: string; noObservation: string; noGrades: string; issued: string; familySignature: string; previousRows: string; gradeExplanationTitle: string;
};

const LABELS: Record<AppLanguage, Labels> = {
  es: { title: 'Hoja de seguimiento', student: 'Alumno', course: 'Curso', trimester: 'Trimestre', report: 'Hoja', subject: 'Asignatura', teacher: 'Profesor', assessment: 'Evaluación', type: 'Tipo', date: 'Fecha', grade: 'Nota', observation: 'Observación', exam: 'Examen', continuous: 'Evaluación continua', tutorObservation: 'Observaciones del tutor', noObservation: 'Sin observaciones', noGrades: 'Sin notas', issued: 'Fecha de emisión', familySignature: 'Firma de la familia', previousRows: 'Las filas grisáceas ya estaban en el informe anterior.', gradeExplanationTitle: 'Equivalencias de las notas' },
  ca: { title: 'Full de seguiment', student: 'Alumne', course: 'Curs', trimester: 'Trimestre', report: 'Full', subject: 'Assignatura', teacher: 'Professor', assessment: 'Avaluació', type: 'Tipus', date: 'Data', grade: 'Nota', observation: 'Observació', exam: 'Examen', continuous: 'Avaluació contínua', tutorObservation: 'Observacions del tutor', noObservation: 'Sense observacions', noGrades: 'Sense notes', issued: 'Data d’emissió', familySignature: 'Signatura de la família', previousRows: 'Les files grisenques ja eren a l’informe anterior.', gradeExplanationTitle: 'Equivalències de les notes' },
  en: { title: 'Student Progress Tracker', student: 'Student', course: 'Year', trimester: 'Term', report: 'Tracker', subject: 'Subject', teacher: 'Teacher', assessment: 'Assessment', type: 'Type', date: 'Date', grade: 'Grade', observation: 'Observation', exam: 'Exam', continuous: 'Continuous assessment', tutorObservation: 'Tutor observations', noObservation: 'No observations', noGrades: 'No grades', issued: 'Issue date', familySignature: 'Family signature', previousRows: 'Grey rows were already in the previous tracker.', gradeExplanationTitle: 'Grade equivalents' },
  eu: { title: 'Jarraipen fitxa', student: 'Ikaslea', course: 'Maila', trimester: 'Hiruhilekoa', report: 'Fitxa', subject: 'Irakasgaia', teacher: 'Irakaslea', assessment: 'Ebaluazioa', type: 'Mota', date: 'Data', grade: 'Nota', observation: 'Oharra', exam: 'Azterketa', continuous: 'Etengabeko ebaluazioa', tutorObservation: 'Tutorearen oharrak', noObservation: 'Oharrik gabe', noGrades: 'Notarik gabe', issued: 'Emate-data', familySignature: 'Familiaren sinadura', previousRows: 'Lerro grisak aurreko jarraipen-fitxan zeuden.', gradeExplanationTitle: 'Noten baliokidetzak' },
  gl: { title: 'Folla de seguimento', student: 'Alumno', course: 'Curso', trimester: 'Trimestre', report: 'Folla', subject: 'Materia', teacher: 'Profesor', assessment: 'Avaliación', type: 'Tipo', date: 'Data', grade: 'Nota', observation: 'Observación', exam: 'Exame', continuous: 'Avaliación continua', tutorObservation: 'Observacións do titor', noObservation: 'Sen observacións', noGrades: 'Sen notas', issued: 'Data de emisión', familySignature: 'Sinatura da familia', previousRows: 'As filas grises xa estaban na folla anterior.', gradeExplanationTitle: 'Equivalencias das notas' }
};

const ASSESSMENT_WEIGHT_NOTICE: Record<AppLanguage, string> = {
  es: 'La calificación se pondera con un {exam}% de exámenes y un {continuous}% de evaluación continua.',
  ca: 'La qualificació es pondera amb un {exam}% d’exàmens i un {continuous}% d’avaluació contínua.',
  en: 'Grades are weighted as {exam}% exams and {continuous}% continuous assessment.',
  eu: 'Kalifikazioa azterketen {exam}%arekin eta etengabeko ebaluazioaren {continuous}%arekin haztatzen da.',
  gl: 'A cualificación pondera un {exam}% de exames e un {continuous}% de avaliación continua.'
};

const REPORT_INFORMATION_TITLES: Record<AppLanguage, { information: string; gradeExplanation: string }> = {
  es: { information: 'Información del informe', gradeExplanation: 'Significado de las siglas' },
  ca: { information: 'Informació de l’informe', gradeExplanation: 'Significat de les sigles' },
  en: { information: 'Report information', gradeExplanation: 'Meaning of abbreviations' },
  eu: { information: 'Txostenaren informazioa', gradeExplanation: 'Siglen esanahia' },
  gl: { information: 'Información do informe', gradeExplanation: 'Significado das siglas' }
};

const TRIMESTERS: Record<AppLanguage, Record<string, string>> = {
  es: { T_1: 'Primer trimestre', T_2: 'Segundo trimestre', T_3: 'Tercer trimestre' },
  ca: { T_1: 'Primer trimestre', T_2: 'Segon trimestre', T_3: 'Tercer trimestre' },
  en: { T_1: 'First term', T_2: 'Second term', T_3: 'Third term' },
  eu: { T_1: 'Lehen hiruhilekoa', T_2: 'Bigarren hiruhilekoa', T_3: 'Hirugarren hiruhilekoa' },
  gl: { T_1: 'Primeiro trimestre', T_2: 'Segundo trimestre', T_3: 'Terceiro trimestre' }
};

const LOCALES: Record<AppLanguage, string> = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', eu: 'eu-ES', gl: 'gl-ES' };
const PDF_FILENAME_LABELS: Record<AppLanguage, { document: string; student: string; classGroup: string }> = {
  es: { document: 'hoja', student: 'alumno', classGroup: 'clase' },
  ca: { document: 'full', student: 'alumne', classGroup: 'classe' },
  en: { document: 'tracker', student: 'student', classGroup: 'class' },
  eu: { document: 'fitxa', student: 'ikaslea', classGroup: 'gela' },
  gl: { document: 'folla', student: 'alumno', classGroup: 'clase' }
};
const PDF_LANGUAGE_SUFFIX: Record<AppLanguage, string> = { es: 'ESP', ca: 'CAT', en: 'ENG', eu: 'EUS', gl: 'GAL' };
const FOLDER_DIALOG: Record<AppLanguage, { title: string; buttonLabel: string }> = {
  es: { title: 'Selecciona la carpeta para guardar los PDF', buttonLabel: 'Guardar aquí' },
  ca: { title: 'Selecciona la carpeta on desar els PDF', buttonLabel: 'Desar aquí' },
  en: { title: 'Choose the folder for the PDF files', buttonLabel: 'Save here' },
  eu: { title: 'Hautatu PDF fitxategiak gordetzeko karpeta', buttonLabel: 'Gorde hemen' },
  gl: { title: 'Selecciona o cartafol onde gardar os PDF', buttonLabel: 'Gardar aquí' }
};

export const pdfFolderDialogLabels = (language: AppLanguage) => FOLDER_DIALOG[language];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const tutorObservationLabel = (language: AppLanguage, sex?: TeacherProfile['sex']) => {
  if (language === 'ca') return sex === 'FEMALE' ? 'Observacions de la tutora' : 'Observacions del tutor';
  if (language === 'es') return sex === 'FEMALE' ? 'Observaciones de la tutora' : 'Observaciones del tutor';
  if (language === 'gl') return sex === 'FEMALE' ? 'Observacións da titora' : 'Observacións do titor';
  return LABELS[language].tutorObservation;
};
const kindName = (labels: Labels, kind?: AssessmentKind) => kind === 'EXAM' ? labels.exam : kind === 'CONTINUOUS_ASSESSMENT' ? labels.continuous : '—';
const gradeExplanation = (explanations: Record<string, string>) => Object.entries(explanations).map(([grade, explanation]) => `<b>${escapeHtml(grade)}</b>: ${escapeHtml(explanation)}`).join(' · ');
const displayGrade = (value: string, configuration: TrackingReportsExport['centerConfiguration']) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.toLocaleUpperCase() === configuration.notEvaluatedValue.trim().toLocaleUpperCase()) return configuration.notEvaluatedValue;
  if (configuration.finalReportGradeMode !== 'LETTER') return trimmed;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return trimmed;
  return letterGradeForNumericValue(Number(normalized), configuration.grades) ?? trimmed;
};
const gradeTone = (value: string, configuration: TrackingReportsExport['centerConfiguration']) => {
  const normalized = value.trim().toLocaleUpperCase();
  if (!normalized || normalized === configuration.notEvaluatedValue.trim().toLocaleUpperCase()) return 'grade-empty';
  const numeric = Number(normalized.replace(',', '.'));
  if (/^\d{1,2}(?:[.,]\d{1,2})?$/.test(normalized)) return numeric < 5 ? 'grade-red' : 'grade-pass';
  const letterGrade = configuration.grades.find(item => item.grade.trim().toLocaleUpperCase() === normalized);
  if (letterGrade) return letterGrade.from < 5 ? 'grade-red' : 'grade-pass';
  return 'grade-pass';
};
const displayDate = (date: string | undefined, language: AppLanguage) => {
  if (!date) return '—';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(LOCALES[language], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
};

export function buildStudentReportHtml(report: TrackingReportsExport, studentIndex: number) {
  const student = report.students[studentIndex];
  if (!student) throw new Error('INVALID_STUDENT');
  const language = report.language;
  const labels = { ...LABELS[language], tutorObservation: tutorObservationLabel(language, report.tutorSex) };
  const trimester = TRIMESTERS[language][report.trimester.id] ?? report.trimester.name;
  const trimesterValue = trimester.replace(/\s+(?:trimestre|term|hiruhilekoa)$/i, '');
  const assessmentWeightNotice = ASSESSMENT_WEIGHT_NOTICE[language].replace('{exam}', String(report.centerConfiguration.examWeight)).replace('{continuous}', String(report.centerConfiguration.continuousAssessmentWeight));
  const reportInformationTitles = REPORT_INFORMATION_TITLES[language];
  const subjectSections = report.subjects.map(reportSubject => {
    const studentSubject = student.subjects.find(subject => subject.name === reportSubject.name);
    if (!studentSubject) return '';
    const columns = reportSubject.columns.filter(column => !column.isIndividual || studentSubject.applicability?.[column.id] === 'APPLICABLE');
    if (!reportSubject.isExcluded && !columns.length && reportSubject.columns.some(column => column.isIndividual)) return '';
    const displayedName = reportSubject.name;
    const rows = reportSubject.isExcluded ? `<tr><td class="subject-no-grades" colspan="5">${escapeHtml(labels.noGrades)}</td></tr>` : columns.map(column => {
      const notApplicable = studentSubject.applicability?.[column.id] === 'NOT_APPLICABLE';
      const grade = notApplicable ? '' : displayGrade(studentSubject.values[column.id] ?? '', report.centerConfiguration);
      return `<tr${column.isExisting ? ' class="previous-assessment-row"' : ''}>
        <td class="assessment">${escapeHtml(column.name)}</td>
        <td>${escapeHtml(kindName(labels, column.kind))}</td>
        <td class="date">${escapeHtml(displayDate(column.assessmentDate, language))}</td>
        <td class="grade ${notApplicable ? 'grade-empty' : gradeTone(grade, report.centerConfiguration)}">${escapeHtml(notApplicable ? 'N/A' : grade || '—')}</td>
        <td class="observation">${escapeHtml(studentSubject.observations[column.id]?.trim() || '—')}</td>
      </tr>`;
    }).join('');
    return `<section class="subject-block">
      <header><div><h2>${escapeHtml(displayedName)}</h2></div></header>
      <table><thead><tr><th>${escapeHtml(labels.assessment)}</th><th>${escapeHtml(labels.type)}</th><th>${escapeHtml(labels.date)}</th><th>${escapeHtml(labels.grade)}</th><th>${escapeHtml(labels.observation)}</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }).join('');
  const previousRowsLegend = report.report.derivedFromSequence !== undefined ? `<span class="previous-rows-note">${escapeHtml(labels.previousRows)}</span>` : '';
  const reportInformationCard = report.centerConfiguration.hasAssessmentWeights || previousRowsLegend
    ? `<aside class="assessment-weight-notice"><b class="report-information-title">${escapeHtml(reportInformationTitles.information)}</b>${report.centerConfiguration.hasAssessmentWeights ? `<span>${escapeHtml(assessmentWeightNotice)}</span>` : ''}${previousRowsLegend}</aside>`
    : '';
  const reportInformation = [
    reportInformationCard,
    report.centerConfiguration.hasLetterGrades && report.centerConfiguration.gradesExplanation && Object.keys(report.centerConfiguration.gradesExplanation).length ? `<aside class="grade-explanation"><b>${escapeHtml(reportInformationTitles.gradeExplanation)}</b><span>${gradeExplanation(report.centerConfiguration.gradesExplanation)}</span></aside>` : ''
  ].join('');

  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escapeHtml(student.name)} · ${escapeHtml(labels.title)}</title><style>
    @page{size:A4;margin:12mm 13mm 18mm}*{box-sizing:border-box}html{font-family:"Segoe UI",Arial,sans-serif;color:#20332e;font-size:10px}body{margin:0;background:#fff}.report-header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #18705d;padding:4px 0 5px;margin-bottom:28px;min-height:72px}.brand{display:flex;align-items:center;gap:11px}.logo{width:220px;height:64px;object-fit:contain;object-position:left center}.mark{width:56px;height:56px;border-radius:11px;background:#18705d;color:#fff;display:grid;place-items:center;font-weight:800;font-size:24px}.report-title{text-align:right}.report-title h1{font-size:21px;line-height:1.1;margin:0}.report-title p{font-size:11px;font-weight:400;color:#72817c;margin:5px 0 0}.report-name{font-weight:700;color:#18705d;background:#e7f2ee;padding:7px 10px;border-radius:7px}.student-card{display:grid;grid-template-columns:2fr repeat(4,1fr);border:1px solid #d8e2de;border-radius:8px;overflow:hidden;margin-bottom:24px}.student-card div{padding:9px 11px;border-right:1px solid #e2e9e6}.student-card div:last-child{border:0}.student-card span,.subject-block header span{display:block;color:#72817c;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.65px;margin-bottom:3px}.student-card strong{font-size:11px}.report-information{display:grid;gap:8px;margin:0 0 16px}.assessment-weight-notice{border:1px solid #bcd9cf;border-left:4px solid #18705d;background:#eef8f4;border-radius:7px;padding:9px 11px;font-size:10px;font-weight:600;color:#244b40;line-height:1.4}.grade-explanation{border:1px solid #d8e2de;border-left:4px solid #6b8a7f;background:#f7faf9;border-radius:7px;padding:9px 11px;color:#52665e;font-size:10px;line-height:1.45}.grade-explanation>b{display:block;color:#38534b;font-size:10px;margin-bottom:3px}.grade-explanation span{display:block}.report-change-legend{display:flex;align-items:center;gap:8px;border:1px solid #d8e2de;background:#fafcfb;border-radius:7px;padding:8px 11px;color:#6d7975;font-size:9px;font-weight:600;line-height:1.35}.report-change-swatch{width:18px;height:13px;flex:none;border:1px solid #d7dfdc;border-radius:3px;background:#f1f3f2}.subject-block{border:1px solid #d8e2de;border-radius:8px;overflow:hidden;margin:0 0 11px;break-inside:avoid-page}.subject-block header{display:flex;justify-content:space-between;align-items:flex-end;gap:15px;background:#f3f7f5;padding:8px 10px;border-bottom:1px solid #d8e2de}.subject-block h2{font-size:13px;margin:0;color:#1f4e42}.subject-block header p{margin:0;color:#5e6f69;text-align:right;font-size:9px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#e9f1ee;color:#38534b;text-align:left;font-size:8px;padding:6px 7px;border-right:1px solid #d6e1dd}th:nth-child(1){width:22%}th:nth-child(2){width:17%}th:nth-child(3){width:14%}th:nth-child(4){width:10%;text-align:center}th:nth-child(5){width:37%}td{padding:7px;border-top:1px solid #e5ebe8;border-right:1px solid #e5ebe8;vertical-align:top;line-height:1.35;overflow-wrap:anywhere}.subject-no-grades{padding:14px;text-align:center;color:#72817c;font-weight:600;background:#fafcfb}tr.previous-assessment-row{background:#f1f3f2;color:#7d8884}tr.previous-assessment-row td,tr.previous-assessment-row .grade{color:inherit}.grade{text-align:center;font-weight:800}.grade-pass{color:#176a58}.grade-red{color:#bd3c3c}.grade-empty{color:#91a09a;font-weight:600}.date{white-space:nowrap}.observation{white-space:pre-wrap}.tutor-note{border-left:4px solid #e1a932;background:#fff9eb;border-radius:7px;padding:10px 12px;margin-top:14px;break-inside:avoid}.tutor-note h2{font-size:11px;margin:0 0 5px}.tutor-note p{margin:0;line-height:1.5;white-space:pre-wrap;color:#43534e}.family-signature{margin-top:22px;width:46%;break-inside:avoid}.family-signature span{display:block;color:#72817c;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.65px;margin-bottom:18px}.family-signature div{border-bottom:1px solid #60736b;height:1px}
    .report-information-title{display:block;color:#38534b;font-size:10px;font-weight:800;margin-bottom:2px}.assessment-weight-notice>span{display:block}.previous-rows-note{display:block;margin-top:2px}tr.previous-assessment-row .grade.grade-red{color:#bd3c3c}tr.previous-assessment-row .grade.grade-pass{color:#176a58}tr.previous-assessment-row .grade.grade-empty{color:#91a09a}th{font-size:10px}
  </style></head><body>
    <header class="report-header"><div class="brand">${report.schoolLogo ? `<img class="logo" src="${escapeHtml(report.schoolLogo)}" alt="">` : '<div class="mark">E</div>'}</div><div class="report-title"><h1>${escapeHtml(labels.title)}</h1><p>${escapeHtml(trimester)} · ${escapeHtml(labels.report)} ${report.report.sequence}</p></div></header>
    <section class="student-card"><div><span>${escapeHtml(labels.student)}</span><strong>${escapeHtml(student.name)}</strong></div><div><span>${escapeHtml(labels.course)}</span><strong>${escapeHtml(report.course.name)}</strong></div><div><span>${escapeHtml(labels.trimester)}</span><strong>${escapeHtml(trimesterValue)}</strong></div><div><span>${escapeHtml(labels.report)}</span><strong>${report.report.sequence}</strong></div><div><span>${escapeHtml(labels.issued)}</span><strong>${escapeHtml(displayDate(report.generatedAt.slice(0, 10), language))}</strong></div></section>
    ${reportInformation ? `<section class="report-information">${reportInformation}</section>` : ''}
    ${subjectSections}
    <section class="tutor-note"><h2>${escapeHtml(labels.tutorObservation)}</h2><p>${escapeHtml(student.tutorObservation.trim() || labels.noObservation)}</p></section>
    <section class="family-signature"><span>${escapeHtml(labels.familySignature)}</span><div></div></section>
  </body></html>`;
}

const pdfFooterTemplate = `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#89948f;border-top:1px solid #dfe6e3;padding:6px 13mm 0;display:flex;justify-content:space-between"><span>EduTrack v${APP_VERSION}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;

export function studentReportFilename(report: TrackingReportsExport, studentName: string) {
  const safeStudent = studentName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || PDF_FILENAME_LABELS[report.language].student;
  const course = report.course.level.replace('_', '');
  const trimester = report.trimester.id.replace('_', '');
  const documentName = PDF_FILENAME_LABELS[report.language].document;
  const generatedDate = report.generatedAt.slice(0, 10).replaceAll('-', '');
  return `${course}_${trimester}_${documentName}-${report.report.sequence}_${generatedDate}_${safeStudent}_${PDF_LANGUAGE_SUFFIX[report.language]}.pdf`;
}

export function combinedStudentReportFilename(report: TrackingReportsExport) {
  const course = report.course.level.replace('_', '');
  const trimester = report.trimester.id.replace('_', '');
  const documentName = PDF_FILENAME_LABELS[report.language].document;
  const generatedDate = report.generatedAt.slice(0, 10).replaceAll('-', '');
  return `${course}_${trimester}_${documentName}-${report.report.sequence}_${generatedDate}_${PDF_FILENAME_LABELS[report.language].classGroup}_${PDF_LANGUAGE_SUFFIX[report.language]}.pdf`;
}

export async function mergeStudentReportPdfs(documents: readonly Uint8Array[]) {
  if (documents.length === 0) throw new Error('NO_STUDENTS');
  const combined = await PDFDocument.create();
  for (const document of documents) {
    const source = await PDFDocument.load(document);
    const pages = await combined.copyPages(source, source.getPageIndices());
    pages.forEach(page => combined.addPage(page));
  }
  return combined.save();
}

async function availablePath(directory: string, filename: string) {
  const stem = filename.slice(0, -4);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(directory, suffix === 1 ? filename : `${stem}-${suffix}.pdf`);
    try { await access(candidate); } catch { return candidate; }
  }
}

export async function writeStudentReportPdfs(report: TrackingReportsExport, directory: string, frozenHtml?: string[]) {
  if (report.students.length === 0) throw new Error('NO_STUDENTS');
  if (frozenHtml && frozenHtml.length !== report.students.length) throw new Error('INVALID_REPORT_SNAPSHOT');
  const printWindow = new BrowserWindow({ show: false, backgroundColor: '#ffffff', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let count = 0;
  const studentPdfs: Uint8Array[] = [];
  try {
    for (let index = 0; index < report.students.length; index += 1) {
      const html = frozenHtml?.[index] ?? buildStudentReportHtml(report, index);
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printWindow.webContents.printToPDF({ displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: pdfFooterTemplate, printBackground: true, preferCSSPageSize: true, margins: { top: 0.5, bottom: 0.55, left: 0, right: 0 } });
      studentPdfs.push(pdf);
      const path = await availablePath(directory, studentReportFilename(report, report.students[index].name));
      await writeFile(path, pdf);
      count += 1;
    }
    const combinedPdf = await mergeStudentReportPdfs(studentPdfs);
    await writeFile(await availablePath(directory, combinedStudentReportFilename(report)), combinedPdf);
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
  return count;
}

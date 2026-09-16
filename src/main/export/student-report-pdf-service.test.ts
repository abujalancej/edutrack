import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { TrackingReportsExport } from '../../shared/types/models';
import { DEFAULT_CENTER_CONFIGURATION, DEFAULT_GRADE_CONVERSION } from '../../shared/center/center-configuration';
import { buildStudentReportHtml, combinedStudentReportFilename, mergeStudentReportPdfs, studentReportFilename } from './student-report-pdf-service';

const report: TrackingReportsExport = {
  format: 'edutrack-tracking-reports', version: 1, generatedAt: '2026-09-14T10:00:00.000Z', language: 'ca',
  centerConfiguration: { ...DEFAULT_CENTER_CONFIGURATION, examWeight: 70, continuousAssessmentWeight: 30, hasAssessmentWeights: true },
  course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' }, report: { sequence: 2, derivedFromSequence: 1 },
  subjects: [
    {
      name: 'Llengua Catalana', teacher: { firstName: 'Marta', lastName: 'Serra' }, gradeMode: 'NUMERIC', exportedAt: '2026-09-13T10:00:00.000Z',
      columns: [
        { id: 'exam-1', name: 'Examen 1', kind: 'EXAM', assessmentDate: '2026-09-10', isExisting: true },
        { id: 'activity-1', name: 'Comentari de text', kind: 'CONTINUOUS_ASSESSMENT', assessmentDate: '2026-09-12', isExisting: false }
      ]
    }
  ],
  students: [
    { name: 'Anna García', tutorObservation: 'Ha millorat molt.', subjects: [{ name: 'Llengua Catalana', values: { 'exam-1': '8,5', 'activity-1': '9' }, observations: { 'exam-1': 'Bon domini.', 'activity-1': 'Molt completa.' } }] },
    { name: 'Pau Martí', tutorObservation: '', subjects: [{ name: 'Llengua Catalana', values: { 'exam-1': '5', 'activity-1': '6' }, observations: { 'exam-1': 'Dades d’un altre alumne.' } }] }
  ]
};

describe('student report PDF content', () => {
  it('genera un documento aislado con asignaturas, fechas, notas y observaciones del alumno', () => {
    const html = buildStudentReportHtml(report, 0);
    expect(html).toContain('Anna García');
    expect(html).toContain('Llengua Catalana');
    expect(html).toContain('Examen 1');
    expect(html).toContain('10/09/2026');
    expect(html).toContain('8,5');
    expect(html).toContain('Bon domini.');
    expect(html).toContain('Ha millorat molt.');
    expect(html).not.toContain('Pau Martí');
    expect(html).not.toContain('Dades d’un altre alumne.');
    expect(html).toContain('70% d’exàmens');
    expect(html).toContain('30% d’avaluació contínua');
  });

  it('usa identificadores compactos y un nombre de alumno seguro en cada PDF', () => {
    expect(studentReportFilename(report, 'Anna García')).toBe('ESO1_T1_full-2_20260914_anna-garcia_CAT.pdf');
    expect(combinedStudentReportFilename(report)).toBe('ESO1_T1_full-2_20260914_todos_CAT.pdf');
  });

  it.each([
    ['es', 'ESP'], ['ca', 'CAT'], ['en', 'ENG'], ['eu', 'EUS'], ['gl', 'GAL']
  ] as const)('añade el sufijo de idioma %s al final del PDF', (language, suffix) => {
    const localizedReport = { ...report, language };
    expect(studentReportFilename(localizedReport, 'Anna García')).toMatch(new RegExp(`_${suffix}\\.pdf$`));
  });

  it('trata una optativa como una asignatura normal y deja vacías las notas del alumnado que no la cursa', () => {
    const elective = structuredClone(report);
    elective.subjects = [{ name: 'Francès', teacher: { firstName: 'Laura', lastName: 'Pons' }, exportedAt: '2026-09-13T10:00:00.000Z', columns: [{ id: 'exam', name: 'Examen', kind: 'EXAM', assessmentDate: '2026-09-10' }] }];
    elective.students = [
      { name: 'Anna García', tutorObservation: '', subjects: [{ name: 'Francès', values: { exam: '8' }, observations: { exam: 'Très bien.' } }] },
      { name: 'Pau Martí', tutorObservation: '', subjects: [{ name: 'Francès', values: {}, observations: {} }] }
    ];
    const html = buildStudentReportHtml(elective, 0);
    expect(html).toContain('Francès');
    expect(html).not.toContain('Laura Pons');
    expect(html).toContain('Très bien.');
    expect(html).not.toContain('Alemany');
  });

  it('mantiene una asignatura excluida con una única celda sin notas', () => {
    const excluded = structuredClone(report);
    excluded.subjects[0].isExcluded = true;
    const html = buildStudentReportHtml(excluded, 0);
    expect(html).toContain('Llengua Catalana');
    expect(html).toContain('<td class="subject-no-grades" colspan="5">Sense notes</td>');
    expect(html).not.toContain('Bon domini.');
    expect(html).not.toContain('8,5');
  });

  it('escapa el contenido introducido por el usuario', () => {
    const unsafe = structuredClone(report);
    unsafe.students[0].tutorObservation = '<script>alert("x")</script>';
    const html = buildStudentReportHtml(unsafe, 0);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('presenta NP y guion como valores especiales', () => {
    const special = structuredClone(report);
    special.students[0].subjects[0].values['exam-1'] = 'NP';
    special.students[0].subjects[0].values['activity-1'] = '-';
    const html = buildStudentReportHtml(special, 0);
    expect(html).toContain('>NP</td>');
    expect(html).toContain('>-</td>');
  });

  it.each(['es', 'ca', 'en', 'eu', 'gl'] as const)('muestra la ponderación antes de las tablas en %s', language => {
    const html = buildStudentReportHtml({ ...report, language, centerConfiguration: { ...DEFAULT_CENTER_CONFIGURATION, examWeight: 65, continuousAssessmentWeight: 35, hasAssessmentWeights: true } }, 0);
    expect(html).toContain('65%');
    expect(html).toContain('35%');
    expect(html).toMatch(/<b class="report-information-title">[^<]+<\/b>/);
    expect(html.indexOf('assessment-weight-notice')).toBeLessThan(html.indexOf('<table>'));
  });

  it('omite la información de porcentajes sin una configuración explícita', () => {
    const html = buildStudentReportHtml({ ...report, centerConfiguration: DEFAULT_CENTER_CONFIGURATION }, 0);
    expect(html).not.toContain('<div class="assessment-weight-details">');
    expect(html).not.toContain('La qualificació es pondera');
    expect(html).toContain('<b class="report-information-title">Informació de l’informe</b>');
  });

  it('explica las equivalencias de las notas con letras', () => {
    const letterReport = {
      ...report,
      centerConfiguration: { ...DEFAULT_CENTER_CONFIGURATION, grades: [...DEFAULT_GRADE_CONVERSION], gradesExplanation: { NA: 'No assoliment', AS: 'Assoliment satisfactori', AN: 'Assoliment notable', AE: 'Assoliment excel·lent', NP: 'No presentat' }, hasLetterGrades: true, finalReportGradeMode: 'LETTER' as const }
    };
    const html = buildStudentReportHtml(letterReport, 0);
    expect(html).toContain('grade-explanation');
    expect(html).toContain('Significat de les sigles');
    expect(html).toContain('<b>NA</b>: No assoliment');
    expect(html).toContain('<b>AS</b>: Assoliment satisfactori');
    expect(html).toContain('<b>AN</b>: Assoliment notable');
    expect(html).toContain('<b>AE</b>: Assoliment excel·lent');
    expect(html).toContain('<b>NP</b>: No presentat');
    expect(html).not.toContain('+ y - indican');
    expect(html).toMatch(/\.grade-explanation\{[^}]*font-size:10px/);
    expect(html).toMatch(/\.grade-explanation>b\{[^}]*font-size:10px/);
  });

  it('convierte las notas numéricas a letras y mantiene su color en un informe LETTER', () => {
    const letterReport = structuredClone(report);
    letterReport.centerConfiguration = {
      ...DEFAULT_CENTER_CONFIGURATION,
      finalReportGradeMode: 'LETTER',
      notEvaluatedValue: 'NP',
      grades: [...DEFAULT_GRADE_CONVERSION],
      gradesExplanation: { NA: 'No assoliment', AS: 'Assoliment satisfactori', AN: 'Assoliment notable', AE: 'Assoliment excel·lent', NP: 'No presentat' },
      hasLetterGrades: true
    };
    letterReport.students[0].subjects[0].values['exam-1'] = '4,5';
    letterReport.students[0].subjects[0].values['activity-1'] = '8.5';
    const html = buildStudentReportHtml(letterReport, 0);
    expect(html).toContain('class="grade grade-red">NA+</td>');
    expect(html).toContain('class="grade grade-pass">AN+</td>');
    expect(html).toContain('tr.previous-assessment-row .grade.grade-red{color:#bd3c3c}');
    expect(html).toContain('tr.previous-assessment-row .grade.grade-pass{color:#176a58}');
    expect(html).not.toContain('>4,5</td>');
    expect(html).not.toContain('>8.5</td>');
  });

  it('diferencia las filas heredadas y explica el código de color', () => {
    const html = buildStudentReportHtml(report, 0);
    expect(html.match(/<tr class="previous-assessment-row">/g)).toHaveLength(1);
    expect(html).toContain('Les files grisenques ja eren a l’informe anterior.');
    expect(html).not.toContain('<div class="report-change-legend">');
    expect(html).not.toContain('<span class="report-change-swatch"');
    expect(html).toContain('<span class="previous-rows-note">Les files grisenques ja eren a l’informe anterior.</span>');
    expect(html.indexOf('<span class="previous-rows-note">')).toBeGreaterThan(html.indexOf('30% d’avaluació contínua'));
    expect(html.indexOf('<span class="previous-rows-note">')).toBeLessThan(html.indexOf('<table>'));
  });

  it('combina los PDF individuales en orden sin volver a paginarlos', async () => {
    const first = await PDFDocument.create(); first.addPage([100, 100]);
    const second = await PDFDocument.create(); second.addPage([200, 200]); second.addPage([300, 300]);
    const mergedBytes = await mergeStudentReportPdfs([await first.save(), await second.save()]);
    const merged = await PDFDocument.load(mergedBytes);
    expect(merged.getPages().map(page => page.getWidth())).toEqual([100, 200, 300]);
  });
});

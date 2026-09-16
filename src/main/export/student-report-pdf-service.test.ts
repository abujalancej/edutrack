import { describe, expect, it } from 'vitest';
import type { TrackingReportsExport } from '../../shared/types/models';
import { DEFAULT_CENTER_CONFIGURATION } from '../../shared/center/center-configuration';
import { buildCombinedStudentReportHtml, buildStudentReportHtml, combinedStudentReportFilename, studentReportFilename } from './student-report-pdf-service';

const report: TrackingReportsExport = {
  format: 'edutrack-tracking-reports', version: 1, generatedAt: '2026-09-14T10:00:00.000Z', language: 'ca',
  centerConfiguration: DEFAULT_CENTER_CONFIGURATION,
  course: { level: 'ESO_1', name: '1r ESO' }, trimester: { id: 'T_1', name: '1r Trimestre' }, report: { sequence: 2 },
  subjects: [
    {
      name: 'Llengua Catalana', teacher: { firstName: 'Marta', lastName: 'Serra' }, gradeMode: 'NUMERIC', exportedAt: '2026-09-13T10:00:00.000Z',
      columns: [
        { id: 'exam-1', name: 'Examen 1', kind: 'EXAM', assessmentDate: '2026-09-10' },
        { id: 'activity-1', name: 'Comentari de text', kind: 'CONTINUOUS_ASSESSMENT', assessmentDate: '2026-09-12' }
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
    expect(studentReportFilename(report, 'Anna García')).toBe('ESO1_T1_full-2_anna-garcia_CAT.pdf');
    expect(combinedStudentReportFilename(report)).toBe('ESO1_T1_full-2_todos_CAT.pdf');
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
    expect(html).toContain('Laura Pons');
    expect(html).toContain('Très bien.');
    expect(html).not.toContain('Alemany');
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
    const html = buildStudentReportHtml({ ...report, language, centerConfiguration: { ...DEFAULT_CENTER_CONFIGURATION, examWeight: 65, continuousAssessmentWeight: 35 } }, 0);
    expect(html).toContain('65%');
    expect(html).toContain('35%');
    expect(html.indexOf('assessment-weight-notice')).toBeLessThan(html.indexOf('<table>'));
  });

  it('combina todos los informes del alumnado en un documento paginado', () => {
    const html = buildCombinedStudentReportHtml(report);
    expect(html).toContain('Anna García');
    expect(html).toContain('Pau Martí');
    expect(html).toContain('.combined-student-report{break-after:page}');
  });
});

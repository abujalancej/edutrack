import { describe, expect, it } from 'vitest';
import { reportUi, setActiveLanguage, setActiveTeacherSex, subjectUi, tr, trimesterOptionUi, trimesterUi } from './i18n';

describe('tratamiento según el sexo del docente', () => {
  it('usa el masculino por defecto y el femenino cuando se selecciona', () => {
    setActiveTeacherSex(undefined);
    expect(tr('teacher')).toBe('Profesor');
    expect(tr('tutor')).toBe('Tutor');
    setActiveTeacherSex('FEMALE');
    expect(tr('teacher')).toBe('Profesora');
    expect(tr('tutor')).toBe('Tutora');
    expect(tr('teacherSpace')).toBe('ESPACIO PROFESORA');
    expect(tr('tutorObservations')).toBe('Observaciones de la tutora');
  });
});

describe('etiquetas de trimestre', () => {
  it.each([
    ['es', ['Primer trimestre', 'Segundo trimestre', 'Tercer trimestre']],
    ['ca', ['Primer trimestre', 'Segon trimestre', 'Tercer trimestre']],
    ['en', ['First term', 'Second term', 'Third term']],
    ['eu', ['Lehen hiruhilekoa', 'Bigarren hiruhilekoa', 'Hirugarren hiruhilekoa']],
    ['gl', ['Primeiro trimestre', 'Segundo trimestre', 'Terceiro trimestre']]
  ] as const)('usa ordinales completos en %s', (language, labels) => {
    setActiveLanguage(language);
    expect(['T_1', 'T_2', 'T_3'].map(trimester => trimesterUi(trimester as 'T_1' | 'T_2' | 'T_3'))).toEqual(labels);
    expect(trimesterOptionUi('T_1')).toBe(labels[0]);
  });
});

describe('nombres configurados por el centro', () => {
  it.each(['es', 'ca', 'en', 'eu', 'gl'] as const)('no traduce las asignaturas en %s', language => {
    setActiveLanguage(language);
    expect(subjectUi('Llengua Catalana')).toBe('Llengua Catalana');
    expect(subjectUi('Proyecto interdisciplinar')).toBe('Proyecto interdisciplinar');
  });
});

describe('numeración de informes', () => {
  it.each([
    ['es', ['Primera hoja de seguimiento', 'Segunda hoja de seguimiento', 'Tercera hoja de seguimiento']],
    ['ca', ['Primer full de seguiment', 'Segon full de seguiment', 'Tercer full de seguiment']],
    ['en', ['Student Progress Tracker 1', 'Student Progress Tracker 2', 'Student Progress Tracker 3']],
    ['eu', ['Lehen jarraipen fitxa', 'Bigarren jarraipen fitxa', 'Hirugarren jarraipen fitxa']],
    ['gl', ['Primeira folla de seguimento', 'Segunda folla de seguimento', 'Terceira folla de seguimento']]
  ] as const)('usa ordinales completos en %s', (language, labels) => {
    setActiveLanguage(language);
    expect([1, 2, 3].map(reportUi)).toEqual(labels);
  });
});

describe('descripciones de los perfiles', () => {
  it.each([
    ['es', 'Gestiona asignaturas.', 'Gestiona hojas de seguimiento.'],
    ['ca', 'Gestiona assignatures.', 'Gestiona fulls de seguiment.'],
    ['en', 'Manage subjects.', 'Manage Student Progress Trackers.'],
    ['eu', 'Kudeatu irakasgaiak.', 'Jarraipen fitxak kudeatu.'],
    ['gl', 'Xestiona materias.', 'Xestiona follas de seguimento.']
  ] as const)('usa mensajes breves en %s', (language, teacher, tutor) => {
    setActiveLanguage(language);
    expect(tr('teacherHelp')).toBe(teacher);
    expect(tr('tutorHelp')).toBe(tutor);
  });
});

describe('ayuda del flujo de trabajo', () => {
  it('usa la misma etiqueta en escritura normal para la ayuda y el informe', () => {
    setActiveLanguage('es');
    setActiveTeacherSex('MALE');
    expect(tr('helpTutorObservations')).toBe('Observaciones del tutor');
    expect(tr('tutorObservations')).toBe('Observaciones del tutor');
  });

  it.each([
    ['es', 'Imagen'], ['ca', 'Imatge'], ['en', 'Image'], ['eu', 'Irudia'], ['gl', 'Imaxe']
  ] as const)('nombra claramente el formato de imagen en %s', (language, label) => {
    setActiveLanguage(language);
    expect(tr('imageFile')).toBe(label);
  });
});

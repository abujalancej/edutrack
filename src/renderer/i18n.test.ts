import { describe, expect, it } from 'vitest';
import { centerRosterChangeMessage, centerUpdateText, localizedError, reportUi, setActiveLanguage, setActiveTeacherSex, subjectUi, tr, trimesterOptionUi, trimesterUi } from './i18n';

describe('importación segura del centro', () => {
  it.each(['es', 'ca', 'en', 'eu', 'gl'] as const)('muestra altas y bajas en %s sin ocultar nombres', language => {
    setActiveLanguage(language);
    const message = centerRosterChangeMessage([{ course: '1r ESO', added: ['Carla Costa'], removed: ['Biel Casas'] }]);
    expect(message).toContain('1r ESO');
    expect(message).toContain('Carla Costa');
    expect(message).toContain('Biel Casas');
    expect(tr('replaceCenterDataWarning')).not.toMatch(/sustituidos|substituiran|replaced|ordeztuko|substituiranse/);
    setActiveLanguage('es');
  });
});

describe('protección de entregas e informes', () => {
  it.each(['es', 'ca', 'en', 'eu', 'gl'] as const)('explica en %s cómo reemplazar una entrega obsoleta', language => {
    setActiveLanguage(language);
    expect(localizedError('El listado de la entrega no coincide con el informe. Actualiza el listado y reexporta la entrega.', 'importError')).not.toBe(tr('importError'));
    expect(localizedError('El informe ya está emitido. Copia el informe antes de importar nuevas entregas.', 'importError')).not.toBe(tr('importError'));
    setActiveLanguage('es');
  });
});

describe('vista previa de actualización del centro', () => {
  it.each(['es', 'ca', 'en', 'eu', 'gl'] as const)('tiene todas las etiquetas en %s', language => {
    const labels = centerUpdateText[language];
    expect(Object.values(labels).every(value => value.trim().length > 0)).toBe(true);
    if (language !== 'es') expect(labels.preservation).not.toBe(centerUpdateText.es.preservation);
  });
});

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

describe('textos localizados de la interfaz', () => {
  it.each([
    ['ca', 'Afegir nota', 'Ajuda'],
    ['en', 'Add assessment', 'Help'],
    ['eu', 'Gehitu ebaluazioa', 'Laguntza'],
    ['gl', 'Engadir avaliación', 'Axuda']
  ] as const)('mantiene las acciones y la ayuda en %s', (language, assessment, help) => {
    setActiveLanguage(language);
    expect(tr('addAssessment')).toBe(assessment);
    expect(tr('help')).toBe(help);
    expect(tr('reportsExportedWithCombined', { count: 2 })).not.toContain('generados');
  });

  it.each([
    ['ca', 'La llista d’alumnes no coincideix amb la llista oficial del curs.'],
    ['en', 'The student list does not match the official list for this year.'],
    ['eu', 'Ikasleen zerrenda ez dator bat mailako zerrenda ofizialarekin.'],
    ['gl', 'A lista de alumnos non coincide coa lista oficial do curso.']
  ] as const)('localiza los errores de importación en %s', (language, expected) => {
    setActiveLanguage(language);
    expect(localizedError('La lista de alumnos no coincide con la lista oficial del curso.', 'importError')).toBe(expected);
  });
});

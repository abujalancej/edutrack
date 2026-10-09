import type { AppLanguage } from '../../shared/types/models';

const LABELS = {
  es: { center: 'Datos del centro', courses: 'Catálogo de cursos', subjects: 'Catálogo de asignaturas', logo: 'Logo del centro', roster: 'Listas de alumnos' },
  ca: { center: 'Dades del centre', courses: 'Catàleg de cursos', subjects: 'Catàleg d’assignatures', logo: 'Logo del centre', roster: 'Llistes d’alumnes' },
  en: { center: 'School data', courses: 'Year catalogue', subjects: 'Subject catalogue', logo: 'School logo', roster: 'Student lists' },
  eu: { center: 'Ikastetxeko datuak', courses: 'Mailen katalogoa', subjects: 'Irakasgaien katalogoa', logo: 'Ikastetxeko logoa', roster: 'Ikasleen zerrendak' },
  gl: { center: 'Datos do centro', courses: 'Catálogo de cursos', subjects: 'Catálogo de materias', logo: 'Logo do centro', roster: 'Listas de alumnos' }
};

export const fileDialogLabels = (language: AppLanguage) => LABELS[language];

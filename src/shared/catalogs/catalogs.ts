export const COURSE_LEVELS = ['ESO_1', 'ESO_2', 'ESO_3', 'ESO_4'] as const;
export type CourseLevel = string;

export const TRIMESTERS = ['T_1', 'T_2', 'T_3'] as const;
export type Trimester = (typeof TRIMESTERS)[number];

export const COURSE_LABELS: Record<string, string> = {
  ESO_1: '1r ESO', ESO_2: '2n ESO', ESO_3: '3r ESO', ESO_4: '4t ESO'
};
export const TRIMESTER_LABELS: Record<Trimester, string> = {
  T_1: '1r Trimestre', T_2: '2n Trimestre', T_3: '3r Trimestre'
};

export const SUBJECTS_BY_COURSE: Record<string, readonly string[]> = {
  ESO_1: ['Llengua Catalana', 'Llengua Castellana', 'Llengua Anglesa', 'Matemàtiques', 'Biologia i Geologia', 'Ciències Socials', 'Tecnologia/Robòtica', 'Plàstica', 'Música', 'Religió', 'Optativa'],
  ESO_2: ['Llengua Catalana', 'Llengua Castellana', 'Llengua Anglesa', 'Matemàtiques', 'Física i Química', 'Ciències Socials', 'Tecnologia/Robòtica', 'Plàstica', 'Música', 'Religió', 'Optativa'],
  ESO_3: ['Llengua Catalana', 'Llengua Castellana', 'Llengua Anglesa', 'Matemàtiques', 'Física i Química', 'Biologia i Geologia', 'Ciències Socials', 'Tecnologia/Robòtica', 'Plàstica', 'Música', 'Religió', 'Optativa'],
  ESO_4: ['Llengua Catalana', 'Llengua Castellana', 'Llengua Anglesa', 'Matemàtiques', 'Ciències Socials', 'Biologia i Geologia', 'Tecnologia', 'Valors Cívics', 'Religió', 'Optativa']
};

export const isCourseLevel = (value: unknown): value is CourseLevel => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
export const isTrimester = (value: unknown): value is Trimester => TRIMESTERS.includes(value as Trimester);
export const normalizeTrimester = (value: unknown): Trimester | null => {
  if (isTrimester(value)) return value;
  const legacy = { TRIMESTER_1: 'T_1', TRIMESTER_2: 'T_2', TRIMESTER_3: 'T_3' } as const;
  return typeof value === 'string' ? legacy[value as keyof typeof legacy] ?? null : null;
};
export const isValidSubject = (course: CourseLevel, value: unknown): value is string =>
  typeof value === 'string' && Boolean(SUBJECTS_BY_COURSE[course]?.includes(value));

export const sheetLabel = (course: CourseLevel, trimester: Trimester, subject: string) =>
  `${COURSE_LABELS[course] ?? course} · ${TRIMESTER_LABELS[trimester]} · ${subject}`;

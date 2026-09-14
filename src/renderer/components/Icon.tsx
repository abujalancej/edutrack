type IconName = 'grid' | 'book' | 'report' | 'plus' | 'settings' | 'database' | 'school' | 'teacher' | 'tutor' | 'upload' | 'back' | 'trash' | 'download' | 'copy' | 'users' | 'check' | 'x' | 'sheet' | 'pdf' | 'image' | 'view' | 'calendar' | 'language' | 'edit' | 'up' | 'down';

const paths: Record<IconName, string> = {
  grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H4zm16 0A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h3z',
  report: 'M6 2h9l5 5v15H6zm9 0v5h5M9 17v-3m4 3v-6m4 6V9',
  plus: 'M12 5v14M5 12h14', settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06-.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15', database: 'M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6m-16 6v6c0 2 3.6 3 8 3s8-1 8-3v-6',
  school: 'M3 10l9-6 9 6M5 9v10m14-10v10M3 20h18M9 12v5m6-5v5M8 9h8',
  teacher: 'M4 4h16v12H4zM8 20l4-4 4 4M8 8h8m-8 4h5',
  tutor: 'M3 6l9-4 9 4-9 4zm3 2v6c3 2 9 2 12 0V8M21 6v8', upload: 'M12 16V4m-5 5 5-5 5 5M4 20h16',
  back: 'M19 12H5m6-6-6 6 6 6', trash: 'M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 20h16', copy: 'M8 8h11v12H8zM5 16H4V4h11v1', users: 'M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 2 18.5V20m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-1a3 3 0 1 0 0-6m5 5a4 4 0 0 1 4 4v1',
  check: 'M5 12l4 4L19 6', x: 'M6 6l12 12M18 6 6 18', sheet: 'M6 2h9l5 5v15H6zm9 0v5h5M9 12h8M9 16h8', pdf: 'M6 2h9l5 5v15H6zm9 0v5h5', calendar: 'M5 5h14v15H5zm0 5h14M8 3v4m8-4v4', language: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-18c2.2 2.45 3.35 5.45 3.35 9S14.2 18.55 12 21m0-18C9.8 5.45 8.65 8.45 8.65 12S9.8 18.55 12 21M3.4 9h17.2M3.4 15h17.2',
  image: 'M4 5h16v14H4zm3 10 3.5-4 3 3 2-2 2.5 3M9 9h.01', view: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  edit: 'M4 20l4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6'
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'grid' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} />{name === 'pdf' && <text x="8" y="17" fill="currentColor" stroke="none" fontSize="5.2" fontWeight="800" letterSpacing="-.15">PDF</text>}</svg>;
}

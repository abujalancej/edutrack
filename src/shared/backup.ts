export interface BackupSummary {
  createdAt: string;
  teacher: string;
  courses: number;
  students: number;
  worksheets: number;
  reports: number;
}

export type BackupResult = { ok: true; path: string } | { ok: false; cancelled?: boolean };
export type BackupPreviewResult = { ok: true; token: string; summary: BackupSummary } | { ok: false; cancelled?: boolean };

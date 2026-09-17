import type { TrackingReportsExport } from '../../shared/types/models';
import type { AppDatabase } from '../database/database';
import { buildStudentReportHtml } from './student-report-pdf-service';
import { buildTrackingReports } from './tracking-report-service';

export async function issueTrackingReport(
  db: AppDatabase,
  reportId: number,
  chooseDirectory: (report: TrackingReportsExport) => Promise<string | null>,
  write: (report: TrackingReportsExport, directory: string, html: string[]) => Promise<number>
) {
  const snapshot = db.getReportSnapshot(reportId);
  const data = snapshot?.payload ?? buildTrackingReports(db, reportId);
  const html = snapshot?.html ?? data.students.map((_, index) => buildStudentReportHtml(data, index));
  const directory = await chooseDirectory(data);
  if (!directory) return null;
  const count = await write(data, directory, html);
  if (!snapshot) db.saveIssuedReportSnapshot(reportId, data, html);
  return count;
}

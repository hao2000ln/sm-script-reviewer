import type { ReviewReport } from './report';

export function renderJsonReport(report: ReviewReport): string {
  return JSON.stringify(report, null, 2);
}

import type { Finding } from '../core/index.js';

export interface FileReport {
  path: string;
  source: string;
  findings: Finding[];
}

export interface ScanReport {
  files: FileReport[];
  skipped: Array<{ path: string; reason: string }>;
  durationMs: number;
}

export function severityCounts(report: ScanReport): Record<'error' | 'warning' | 'info', number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const file of report.files) for (const f of file.findings) counts[f.severity]++;
  return counts;
}

export function totalFindings(report: ScanReport): number {
  return report.files.reduce((sum, f) => sum + f.findings.length, 0);
}

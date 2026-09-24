import type { ScanReport } from '../report.js';
import { severityCounts, totalFindings } from '../report.js';

export function formatJson(report: ScanReport): string {
  const payload = {
    ghostchars: true,
    summary: { ...severityCounts(report), total: totalFindings(report), files: report.files.length, durationMs: report.durationMs },
    skipped: report.skipped,
    results: report.files
      .filter((f) => f.findings.length > 0)
      .map((f) => ({
        path: f.path,
        findings: f.findings.map((finding) => ({
          rule: finding.rule,
          severity: finding.severity,
          start: finding.start,
          end: finding.end,
          codePoints: finding.codePoints.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`),
          names: finding.names,
          message: finding.message,
          suggestion: finding.suggestion,
          decoded: finding.decoded,
          skeleton: finding.skeleton,
          fixable: finding.fixable,
        })),
      })),
  };
  return JSON.stringify(payload, null, 2);
}

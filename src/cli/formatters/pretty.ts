import type { Finding } from '../../core/index.js';
import { diagnosticText } from '../../core/diagnosticText.js';
import { colors } from '../colors.js';
import type { ScanReport } from '../report.js';
import { severityCounts, totalFindings } from '../report.js';
import { shortDiagnostic, sourceExcerpt } from './excerpt.js';

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  error: colors.red(colors.bold('error')),
  warning: colors.yellow('warn '),
  info: colors.cyan('info '),
};

export function formatPretty(report: ScanReport): string {
  const lines: string[] = [];

  for (const file of report.files) {
    if (file.findings.length === 0) continue;
    lines.push(colors.underline(diagnosticText(file.path)));
    lines.push(colors.dim('  Bounded source excerpts: [[...]] marks each finding. End positions are exclusive.'));

    for (const f of file.findings) {
      const loc = colors.gray(`${f.start.line}:${f.start.column}-${f.end.line}:${f.end.column}`);
      lines.push(`  ${loc}  ${SEVERITY_LABEL[f.severity]}  ${colors.dim(f.rule)}`);
      lines.push(`    ${shortDiagnostic(f.message)}`);
      lines.push(`    ${colors.gray('|')} ${sourceExcerpt(file.source, f)}`);
      if (f.rule === 'confusable') {
        // The terminal font may draw the two spellings identically. Name the
        // actual scalars, with a bound independent of identifier length.
        const points = f.codePoints.slice(0, 16).map(cp => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
        const omitted = f.codePoints.length > 16 ? ` [${f.codePoints.length - 16} code points omitted; use --format json]` : '';
        lines.push(`    code points: ${points}${omitted}`);
      }
      lines.push(`    ${colors.dim('fix:')} ${shortDiagnostic(f.suggestion)}`);
      lines.push('');
    }
  }

  const counts = severityCounts(report);
  const total = totalFindings(report);
  if (report.errors.length) {
    lines.push(colors.red(`ghostchars: scan incomplete (${report.errors.length} input/repair error(s)); ${total} finding(s) in ${report.files.length} scanned file(s).`));
    for (const error of report.errors) lines.push(`  ${diagnosticText(error.path)}: ${diagnosticText(error.reason)}`);
  } else if (total === 0) {
    lines.push(colors.green(`ghostchars: no findings in ${report.files.length} file(s) (${msToStr(report.durationMs)}).`));
  } else {
    lines.push(colors.bold(`ghostchars: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info in ${report.files.length} file(s) scanned (${msToStr(report.durationMs)}).`));
  }
  if (report.skipped.length) {
    lines.push(colors.dim(`skipped ${report.skipped.length} file(s): ${report.skipped.slice(0, 5).map((s) => diagnosticText(`${s.path} (${s.reason})`)).join(', ')}${report.skipped.length > 5 ? ', …' : ''}`));
  }

  return lines.join('\n');
}

function msToStr(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

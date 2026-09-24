import type { Finding } from '../../core/index.js';
import { reveal } from '../../core/index.js';
import { colors } from '../colors.js';
import type { ScanReport } from '../report.js';
import { severityCounts, totalFindings } from '../report.js';

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  error: colors.red(colors.bold('error')),
  warning: colors.yellow('warn '),
  info: colors.cyan('info '),
};

export function formatPretty(report: ScanReport): string {
  const lines: string[] = [];

  for (const file of report.files) {
    if (file.findings.length === 0) continue;
    lines.push(colors.underline(file.path));
    const sourceLines = file.source.split(/\r\n|\r|\n/);

    for (const f of file.findings) {
      const loc = colors.gray(`${f.start.line}:${f.start.column}`);
      lines.push(`  ${loc}  ${SEVERITY_LABEL[f.severity]}  ${colors.dim(f.rule)}`);
      lines.push(`    ${f.message}`);
      const srcLine = sourceLines[f.start.line - 1] ?? '';
      const revealedLine = reveal(srcLine);
      lines.push(`    ${colors.gray('|')} ${revealedLine}`);
      lines.push(`    ${colors.gray('|')} ${' '.repeat(Math.max(0, f.start.column - 1))}${colors.magenta('^'.repeat(Math.max(1, f.end.offset - f.start.offset)))}`);
      lines.push(`    ${colors.dim('fix:')} ${f.suggestion}`);
      lines.push('');
    }
  }

  const counts = severityCounts(report);
  const total = totalFindings(report);
  if (total === 0) {
    lines.push(colors.green(`ghostchars: no findings in ${report.files.length} file(s) (${msToStr(report.durationMs)}).`));
  } else {
    lines.push(colors.bold(`ghostchars: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info in ${report.files.length} file(s) scanned (${msToStr(report.durationMs)}).`));
  }
  if (report.skipped.length) {
    lines.push(colors.dim(`skipped ${report.skipped.length} file(s): ${report.skipped.slice(0, 5).map((s) => `${s.path} (${s.reason})`).join(', ')}${report.skipped.length > 5 ? ', …' : ''}`));
  }

  return lines.join('\n');
}

function msToStr(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

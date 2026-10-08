import type { Finding } from '../../core/index.js';
import { colors } from '../colors.js';
import type { ScanReport } from '../report.js';
import { severityCounts, totalFindings } from '../report.js';

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  error: colors.red(colors.bold('error')),
  warning: colors.yellow('warn '),
  info: colors.cyan('info '),
};

// Rules whose finding is one particular character, which the line then names.
const BY_CHARACTER = new Set<Finding['rule']>(['invisible', 'unusual-whitespace', 'control-character', 'bidi-control', 'bidi-mark']);

interface Group {
  finding: Finding;
  count: number;
  last: Finding;
  decoded: Set<string>;
}

/**
 * One line per file and kind of finding, with a count and the first and last position, for
 * the file that holds a thousand of the same character (a document pasted from a web page
 * is full of no-break spaces) where `pretty` prints four lines for each. Anything a finding
 * decoded to is shown, since that is the part to read.
 */
export function formatSummary(report: ScanReport): string {
  const lines: string[] = [];
  for (const file of report.files) {
    if (file.findings.length === 0) continue;
    lines.push(colors.underline(file.path));
    const groups = new Map<string, Group>();
    for (const f of file.findings) {
      const key = `${f.severity}\u0000${f.rule}\u0000${BY_CHARACTER.has(f.rule) ? f.names[0] ?? '' : ''}`;
      const group = groups.get(key);
      if (group) {
        group.count++;
        group.last = f;
        if (f.decoded) group.decoded.add(f.decoded);
      } else {
        groups.set(key, { finding: f, count: 1, last: f, decoded: new Set(f.decoded ? [f.decoded] : []) });
      }
    }
    const order = { error: 0, warning: 1, info: 2 };
    for (const g of [...groups.values()].sort((a, b) => order[a.finding.severity] - order[b.finding.severity] || b.count - a.count)) {
      const f = g.finding;
      const what = BY_CHARACTER.has(f.rule) ? `  ${f.names[0] ?? ''}` : '';
      const where = g.count === 1 ? `${f.start.line}:${f.start.column}` : `${f.start.line}:${f.start.column} .. ${g.last.start.line}:${g.last.start.column}`;
      lines.push(`  ${SEVERITY_LABEL[f.severity]}  ${colors.dim(f.rule)}${what}  x${g.count}  ${colors.gray(where)}`);
      for (const text of [...g.decoded].slice(0, 3)) lines.push(`    ${colors.dim('reads:')} ${JSON.stringify(text.length > 120 ? text.slice(0, 120) + '...' : text)}`);
    }
    lines.push('');
  }
  const counts = severityCounts(report);
  const total = totalFindings(report);
  lines.push(total === 0 ? colors.green(`ghostchars: no findings in ${report.files.length} file(s).`) : colors.bold(`ghostchars: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info in ${report.files.length} file(s) scanned.`));
  return lines.join('\n');
}

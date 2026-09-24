import type { ScanReport } from '../report.js';

/** GitHub Actions workflow command annotations (`::error file=…,line=…::…`). */
export function formatGithub(report: ScanReport): string {
  const lines: string[] = [];
  for (const file of report.files) {
    for (const f of file.findings) {
      const cmd = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
      const title = `ghostchars: ${f.rule}`;
      const message = escapeData(f.message);
      lines.push(`::${cmd} file=${file.path},line=${f.start.line},col=${f.start.column},endLine=${f.end.line},endColumn=${f.end.column},title=${escapeProp(title)}::${message}`);
    }
  }
  return lines.join('\n');
}

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProp(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

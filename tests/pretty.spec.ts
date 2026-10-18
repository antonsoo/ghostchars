import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/index.js';
import { formatPretty } from '../src/cli/formatters/pretty.js';
import { shortDiagnostic, sourceExcerpt } from '../src/cli/formatters/excerpt.js';

function report(source: string): string {
  return formatPretty({ files: [{ path: 'input.txt', source, findings: scanText(source).findings }], errors: [], skipped: [], durationMs: 1 });
}

describe('bounded CLI evidence', () => {
  it('names lookalike code points even when the terminal draws the spellings identically', () => {
    const source = 'a \u0430';
    const output = formatPretty({ files: [{ path: 'input.js', source, findings: scanText(source, { isCode: true }).findings }], errors: [], skipped: [], durationMs: 1 });
    expect(output).toContain('code points: U+0061');
    expect(output).toContain('code points: U+0430');
    const dense = report('a\u0430'.repeat(1000));
    expect(dense).toContain('[1984 code points omitted; use --format json]');
    expect(dense.length).toBeLessThan(3000);
  });

  it('keeps every dense-line finding and full counts without repeating the full line', () => {
    const source = 'a\u200b'.repeat(1500);
    const output = report(source);
    expect(output).toContain('1500 warning(s)');
    expect(output.match(/\[\[\\u\{200B\}\]\]/g)).toHaveLength(1500);
    expect(output).toContain('1:3000-1:3001');
    expect(output.length).toBeLessThan(600_000);
    expect(output).not.toContain('\u200b');
  });

  it('keeps original locations without padding to a distant column', () => {
    const source = 'x'.repeat(1_000_000) + '\u200b end';
    const output = report(source);
    expect(output).toContain('1:1000001-1:1000002');
    expect(output).toContain('... ' + 'x'.repeat(32) + '[[\\u{200B}]] end');
    expect(output.length).toBeLessThan(1000);
  });

  it('marks the exact source span after tabs, escaped controls, emoji and wide text', () => {
    const source = '\t🧪漢字\u200bthen\u202e end';
    const finding = scanText(source).findings.find((f) => f.rule === 'bidi-control')!;
    expect(sourceExcerpt(source, finding)).toBe('\\u{0009}🧪漢字\\u{200B}then[[\\u{202E}]] end');
  });

  it('uses complete-input spans across CRLF and bounds long findings without splitting astral text', () => {
    const source = 'line one\r\n🧪\u200b🧪\r\nlast';
    const finding = scanText(source).findings.find((f) => f.rule === 'invisible')!;
    expect(sourceExcerpt(source, finding)).toBe('🧪[[\\u{200B}]]🧪');
    const longer = '🧪'.repeat(1000);
    const span = { ...finding, start: { offset: 0, line: 1, column: 1 }, end: { offset: longer.length, line: 1, column: longer.length + 1 } };
    const output = sourceExcerpt(longer, span);
    expect(output).toContain('[1920 UTF-16 units omitted]');
    expect(output).toBe('[[' + '🧪'.repeat(20) + ' ... [1920 UTF-16 units omitted] ... ' + '🧪'.repeat(20) + ']]');
  });

  it('bounds diagnostic text at complete escape labels and declares the omission', () => {
    const output = shortDiagnostic('text\u001b\u202e'.repeat(100_000));
    expect(output).toContain('[diagnostic shortened; use --format json for full text]');
    expect(output.length).toBeLessThan(1300);
    expect(output).not.toContain('\u001b');
    expect(output).not.toContain('\u202e');
    expect(output).not.toMatch(/\\u\{[^}]*\.\.\./u);
  });
});

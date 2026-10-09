import { describe, expect, it } from 'vitest';
import { computeFix, formatDryRun } from '../src/cli/fix.js';
import { sanitize } from '../src/core/sanitize.js';

describe('repair policy', () => {
  it('keeps a disabled rule while applying an unrelated fix', () => {
    const source = 'a\u200bb \u202Eok\u202C';
    const result = computeFix('text.txt', source, { severityOverrides: { invisible: false } });
    expect(result.newText).toBe('a\u200bb ok');
    expect(result.fixed.every((finding) => finding.rule !== 'invisible')).toBe(true);
  });

  it('keeps allowed spaces while removing zero-width characters', () => {
    expect(computeFix('text.txt', 'price\u00A0USD \u200b', { allowCodePoints: [0xA0] }).newText).toBe('price\u00A0USD ');
  });

  it('applies the same disabled rules when deleting a mark exposes another finding', () => {
    const source = ':\u061C\u200C\u0644';
    expect(computeFix('text.txt', source, { severityOverrides: { invisible: false } }).newText).toBe(':\u200C\u0644');
    expect(computeFix('text.txt', source).newText).toBe(':\u0644');
  });

  it('materializes an allowlist iterable once so it survives subsequent scans', () => {
    const allow = function* () { yield 0x200C; };
    const result = sanitize(':\u061C\u200C\u0644', { scanOptions: { allowCodePoints: allow() } });
    expect(result.text).toBe(':\u200C\u0644');
    expect(result.fixed.map((finding) => finding.rule)).toEqual(['bidi-mark']);
  });

  it('protects allowed scalars even inside a compound removal span', () => {
    // Two byte-per-selector code points behind the visible emoji, only one allowed.
    const source = 'x\u{1F600}\u{E0158}\u{E0159}z';
    const result = sanitize(source, { scanOptions: { allowCodePoints: [0xE0158] } });
    expect(result.text).toBe('x\u{1F600}\u{E0158}z');
    expect(result.remaining.some((finding) => finding.rule === 'variation-selector-stray')).toBe(true);
    expect(sanitize(result.text, { scanOptions: { allowCodePoints: [0xE0158] } }).text).toBe(result.text);
  });

  it('keeps configured severity and file metadata in the findings it fixes', () => {
    const result = computeFix('notes.md', 'a\u200bb', { file: 'notes.md', severityOverrides: { invisible: 'info' } });
    expect(result.fixed).toMatchObject([{ file: 'notes.md', severity: 'info' }]);
  });

  it('keep mode uses the same configured scan', () => {
    expect(sanitize('a\u200bb', { mode: 'keep', scanOptions: { severityOverrides: { invisible: false } } })).toEqual({ text: 'a\u200bb', fixed: [], remaining: [] });
  });
});

describe('repair previews show the proposed output', () => {
  it.each([
    ['overlapping bidi findings', 'a\u202Eb', 'ab'],
    ['retained variation-selector carrier', 'A\uFE0F\uFE0FZ', 'AZ'],
    ['retained astral carrier', 'hi \u{1F600}\u{E0158}\u{E0159} there', 'hi \u{1F600} there'],
    ['second-pass coordinates', ':\u061C\u200C\u0644', ':\u0644'],
  ])('%s', (_name, source, expected) => {
    const result = computeFix('text.txt', source);
    expect(result.newText).toBe(expected);
    expect(formatDryRun(result, source)).toContain(`1: + ${expected}\n`);
  });

  it('shows retained allowed characters visibly on the added line', () => {
    const source = 'price\u00A0USD \u200b';
    const output = formatDryRun(computeFix('text.txt', source, { allowCodePoints: [0xA0] }), source);
    expect(output).toContain('1: + price⟦U+00A0 NBSP⟧USD ');
  });

  it('preserves CR/LF bytes and reports a line joining when removal forms a CRLF pair', () => {
    const source = 'start\r\u200b\nend\n';
    const result = computeFix('text.txt', source);
    expect(result.newText).toBe('start\r\nend\n');
    expect(formatDryRun(result, source)).toContain('2: - ⟦U+200B ZWSP⟧');
    expect(result.newText.match(/[\r\n]/g)).toEqual(source.match(/[\r\n]/g));
  });

  it('quotes terminal controls and bidi characters in filenames and retained text', () => {
    const source = '\u001B[2Ja\u200Bb';
    const path = 'hide\u001B[2J\r\n\u202E.txt';
    const result = computeFix(path, source, { allowCodePoints: [0x1B] });
    const output = formatDryRun(result, source);
    expect(output).not.toContain('\u001B');
    expect(output).not.toContain('\u202E');
    expect(output).not.toContain('\r');
    expect(output).toContain('hide\\u{001B}[2J\\u{000D}\\u{000A}\\u{202E}.txt');
    expect(output).toContain('1: + ⟦U+001B ESC⟧[2Jab');
    expect(result.newText).toBe('\u001B[2Jab');
  });
});

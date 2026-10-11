import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

describe('bidi controls', () => {
  it('flags RLO as an error (Trojan Source shape)', () => {
    const text = 'let a = 1; // ‮force reorder‬';
    const { findings } = scanText(text);
    const rlo = findings.find((f) => f.codePoints.includes(0x202e));
    expect(rlo).toBeDefined();
    expect(rlo!.rule).toBe('bidi-control');
    expect(rlo!.severity).toBe('error');
  });

  it('flags an unterminated embedding at end of line', () => {
    const text = '‮unterminated';
    const { findings } = scanText(text);
    expect(findings.some((f) => f.rule === 'bidi-unbalanced')).toBe(true);
  });

  it('does not flag a properly balanced embedding', () => {
    const text = 'safe ⁦isolated⁩ text';
    const { findings } = scanText(text);
    expect(findings.some((f) => f.rule === 'bidi-unbalanced')).toBe(false);
    // The isolate itself is still an error-class control character.
    expect(findings.filter((f) => f.rule === 'bidi-control')).toHaveLength(2);
  });

  it('flags a stray PDI with nothing to close', () => {
    const text = 'oops⁩';
    const { findings } = scanText(text);
    expect(findings.some((f) => f.rule === 'bidi-unbalanced')).toBe(true);
  });

  it('flags bidi marks as warnings', () => {
    const text = 'a‎b';
    const { findings } = scanText(text);
    const mark = findings.find((f) => f.rule === 'bidi-mark');
    expect(mark).toBeDefined();
    expect(mark!.severity).toBe('warning');
  });

  it('closes nested isolates together with their inner embeddings', () => {
    const { findings } = scanText('\u202a\u2066\u202b\u2067\u202e\u2069\u202c\u2069\u202c');
    expect(findings.filter((finding) => finding.rule === 'bidi-control')).toHaveLength(9);
    expect(findings.filter((finding) => finding.rule === 'bidi-unbalanced')).toEqual([]);
  });

  it.each([
    ['\u202a\u2066\u202c\u2069\u202c', [2]], // PDF cannot close an isolate.
    ['\u2066\u202a\u2069\u202c', [3]], // PDI also closes its inner embedding.
    ['\u2066\n\u202a\u2069', [0, 2, 3]],
    ['\u2066\r\n\u202a\u2069', [0, 3, 4]],
    ['\u2066\r\u202a\u2069', [0, 2, 3]],
  ])('retains unmatched positions across pops and line resets in %j', (text, offsets) => {
    const { findings } = scanText(text);
    expect(findings.filter((finding) => finding.rule === 'bidi-unbalanced')
      .map((finding) => finding.start.offset)).toEqual(offsets);
  });

  it('retains every finding in a dense unmatched-control input', () => {
    const count = 16_000;
    const { findings } = scanText('\u202e'.repeat(count) + '\u2069'.repeat(count));
    expect(findings).toHaveLength(count * 4);
    expect(findings.filter((finding) => finding.rule === 'bidi-unbalanced')).toHaveLength(count * 2);
    expect(findings.at(-1)!.start.offset).toBe(count * 2 - 1);
  });
});

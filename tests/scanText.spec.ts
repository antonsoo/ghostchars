import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

describe('scanText() ASCII fast path', () => {
  it('returns no findings and a correct code point count for plain ASCII text', () => {
    const text = 'function add(a, b) {\n  return a + b;\n}\n';
    const { findings, codePointCount } = scanText(text);
    expect(findings).toEqual([]);
    expect(codePointCount).toBe(text.length);
  });

  it('does not take the fast path when a control character is present (still catches it)', () => {
    const { findings } = scanText('plain\u001btext');
    expect(findings.some((f) => f.rule === 'control-character')).toBe(true);
  });

  it('does not take the fast path when any non-ASCII character is present, however sparse', () => {
    const longAscii = 'x'.repeat(100_000);
    const zwsp = String.fromCodePoint(0x200b);
    const { findings } = scanText(`${longAscii}${zwsp}${longAscii}`);
    expect(findings.some((f) => f.rule === 'invisible')).toBe(true);
  });

  it('treats tab, LF and CR as safe (does not force the slow path on their own)', () => {
    const { findings, codePointCount } = scanText('a\tb\nc\rd');
    expect(findings).toEqual([]);
    expect(codePointCount).toBe(7);
  });
});

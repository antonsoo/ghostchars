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
});

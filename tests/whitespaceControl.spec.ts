import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

describe('unusual whitespace and control characters', () => {
  it('flags a non-breaking space', () => {
    const { findings } = scanText('if (x)');
    expect(findings.some((f) => f.rule === 'unusual-whitespace' && f.codePoints[0] === 0x00a0)).toBe(true);
  });

  it('flags an ideographic space', () => {
    const { findings } = scanText('a　b');
    expect(findings.some((f) => f.rule === 'unusual-whitespace')).toBe(true);
  });

  it('does not flag a normal space, tab, or newline', () => {
    const { findings } = scanText('a b\tc\nd');
    expect(findings.some((f) => f.rule === 'unusual-whitespace' || f.rule === 'control-character')).toBe(false);
  });

  it('flags ESCAPE as an error (terminal escape injection)', () => {
    const { findings } = scanText('normal\u001b[31mred text');
    const finding = findings.find((f) => f.rule === 'control-character' && f.codePoints[0] === 0x1b);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
  });

  it('flags a NULL byte as a warning', () => {
    const { findings } = scanText('a\u0000b');
    const finding = findings.find((f) => f.rule === 'control-character' && f.codePoints[0] === 0);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });
});

describe('braille pattern blank', () => {
  it('flags a braille blank used as a space in ordinary text', () => {
    const { findings } = scanText('pass\u2800word');
    const hit = findings.find((f) => f.codePoints[0] === 0x2800);
    expect(hit?.rule).toBe('unusual-whitespace');
    expect(hit?.names[0]).toBe('BRAILLE PATTERN BLANK');
  });

  it('does not flag the word space between braille patterns', () => {
    // "hello world" in grade-1 braille.
    const { findings } = scanText('\u2813\u2811\u2807\u2807\u2815\u2800\u283a\u2815\u2817\u2807\u2819');
    expect(findings.some((f) => f.codePoints[0] === 0x2800)).toBe(false);
  });
});

describe('French typography', () => {
  it('does not flag the no-break spaces French puts before ; : ! ? and inside guillemets', () => {
    const text = 'Bonjour ! « Citation » et ça va ? Oui : bien ;';
    expect(scanText(text).findings.filter((f) => f.rule === 'unusual-whitespace')).toEqual([]);
  });

  it('still flags a no-break space between words or in code', () => {
    expect(scanText('if (x)').findings.some((f) => f.rule === 'unusual-whitespace')).toBe(true);
    expect(scanText('deux mots').findings.some((f) => f.rule === 'unusual-whitespace')).toBe(true);
  });
});

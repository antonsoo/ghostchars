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

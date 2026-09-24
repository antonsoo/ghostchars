import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

function encodeSmuggled(payload: string): string {
  let out = '';
  for (const byte of Buffer.from(payload, 'utf8')) {
    out += byte < 16 ? String.fromCodePoint(0xfe00 + byte) : String.fromCodePoint(0xe0100 + (byte - 16));
  }
  return out;
}

describe('variation selectors', () => {
  it('does not flag a single VS16 (emoji presentation) after an emoji', () => {
    const { findings } = scanText('❤️ is a heart');
    expect(findings.some((f) => f.rule.startsWith('variation-selector'))).toBe(false);
  });

  it('does not flag a single VS on a CJK ideograph', () => {
    const { findings } = scanText('邊︀ variant');
    expect(findings.some((f) => f.rule.startsWith('variation-selector'))).toBe(false);
  });

  it('flags and decodes a smuggled payload riding on an emoji', () => {
    const smuggled = '\u{1F600}' + encodeSmuggled('hello');
    const { findings } = scanText(smuggled);
    const finding = findings.find((f) => f.rule === 'variation-selector-smuggling');
    expect(finding).toBeDefined();
    expect(finding!.decoded).toBe('hello');
    expect(finding!.severity).toBe('error');
  });

  it('flags a stray variation selector with no base character', () => {
    const { findings } = scanText('︁ leading selector');
    expect(findings.some((f) => f.rule === 'variation-selector-stray')).toBe(true);
  });

  it('flags a single VS16 on a plain ASCII letter as stray (no registered sequence)', () => {
    const { findings } = scanText('a️');
    expect(findings.some((f) => f.rule === 'variation-selector-stray')).toBe(true);
  });
});

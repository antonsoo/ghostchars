import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

describe('confusables', () => {
  it('flags an identifier mixing Latin and Cyrillic', () => {
    // "paypal" with a Cyrillic а (U+0430) in place of Latin a.
    const mixed = 'pаypal';
    const { findings } = scanText(`const ${mixed} = getGateway();`);
    const finding = findings.find((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'));
    expect(finding).toBeDefined();
    expect(finding!.skeleton).toBe('paypal');
  });

  it('does not flag a pure-Latin identifier', () => {
    const { findings } = scanText('const paypal = getGateway();');
    expect(findings.some((f) => f.rule === 'confusable')).toBe(false);
  });

  it('does not flag a pure-Greek identifier used on its own (single script)', () => {
    const { findings } = scanText('const θερμό = 42;'); // θερμό
    expect(findings.some((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'))).toBe(false);
  });

  it('flags two distinct identifiers in one file that share a skeleton', () => {
    const text = `
      const paypal = real();
      const pаypal = fake();
    `;
    const { findings } = scanText(text);
    const collisions = findings.filter((f) => f.rule === 'confusable' && f.message.includes('visually confusable with'));
    expect(collisions.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a pure-ASCII-vs-ASCII lookalike (rn/m, l/1/I) -- not the Unicode attack class this tool targets', () => {
    // "modern" vs "rnodern" (rn/m) and "allow" vs "a11ow" (l/1) both share a
    // skeleton per confusables.txt, but neither side is non-ASCII.
    const text = `
      const modern = a();
      const rnodern = b();
      const allow = c();
      const a11ow = d();
    `;
    const { findings } = scanText(text);
    expect(findings.some((f) => f.rule === 'confusable')).toBe(false);
  });

  it('does not flag Japanese text mixing Han, Hiragana and Katakana (real Japanese, not an attack)', () => {
    // "が別のクラスを拡張していないため" -- a real fragment of everyday
    // Japanese, drawn from the shape of TypeScript's own ja diagnostics.
    const { findings } = scanText('const msg = "が別のクラスを拡張していないため";');
    expect(findings.some((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'))).toBe(false);
  });

  it('does not flag Korean text mixing Han and Hangul', () => {
    const { findings } = scanText('const msg = "참조先프로젝트";'); // Hangul + Han
    expect(findings.some((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'))).toBe(false);
  });

  it('still flags a real cross-script mix outside the CJK-cohesive groups (Latin + Cyrillic)', () => {
    const { findings } = scanText('const pаypal = 1;'); // Latin + Cyrillic а
    expect(findings.some((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'))).toBe(true);
  });

  it('still flags an ASCII spelling colliding with a non-ASCII one', () => {
    // The real attack: a genuine ASCII "admin" plus a Cyrillic-а "аdmin".
    const text = `
      const admin = real();
      const аdmin = fake();
    `;
    const { findings } = scanText(text);
    const collisions = findings.filter((f) => f.rule === 'confusable' && f.message.includes('visually confusable with'));
    expect(collisions).toHaveLength(2);
    expect(collisions.map((f) => f.message).some((m) => m.startsWith('"admin"'))).toBe(true);
  });
});

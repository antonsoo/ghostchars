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
});

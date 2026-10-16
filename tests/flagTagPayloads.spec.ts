import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitize, scanText } from '../src/index.js';

const cases = JSON.parse(readFileSync(new URL('../studies/flag-tag-payloads/cases.json', import.meta.url), 'utf8')) as Array<{
  id: string; text: string; expected: string; findings: number;
}>;
const oracle = JSON.parse(readFileSync(new URL('../studies/flag-tag-payloads/unicode-oracle.json', import.meta.url), 'utf8')) as {
  registered: Array<{ codepoints: number[] }>;
};

describe('flag tag payload controls', () => {
  it.each(cases)('$id: preserves visible content and removes only suspicious tags', item => {
    expect(scanText(item.text).findings).toHaveLength(item.findings);
    const cleaned = sanitize(item.text);
    expect(cleaned.text).toBe(item.expected);
    expect(cleaned.remaining).toEqual([]);
  });

  it('matches independently fetched Unicode flags and rejects every short ASCII wrapper', () => {
    const black = String.fromCodePoint(0x1f3f4), cancel = String.fromCodePoint(0xe007f);
    for (const row of oracle.registered) {
      const flag = String.fromCodePoint(...row.codepoints);
      expect(scanText(flag).findings).toEqual([]);
      expect(sanitize(flag).text).toBe(flag);
    }
    const payloads = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    for (let first = 97; first <= 122; first++) {
      for (let second = 97; second <= 122; second++) payloads.push(String.fromCharCode(first, second));
    }
    for (const payload of payloads) {
      const wrapped = black + [...payload].map(char => String.fromCodePoint(0xe0000 + char.codePointAt(0)!)).join('') + cancel;
      expect(scanText(wrapped).findings, payload).toHaveLength(1);
      expect(sanitize(wrapped).text, payload).toBe(black);
    }
  });
});

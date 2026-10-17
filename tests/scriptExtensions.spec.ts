import { describe, expect, it } from 'vitest';
import { scanText, sanitize } from '../src/core/index.js';
import { scriptOf, scriptsOf } from '../src/core/unicode-utils.js';

describe('complete Script_Extensions aliases', () => {
  it('retains every documented alternative for the modifier apostrophe', () => {
    expect(scriptOf(0x2bc)).toBe('Common');
    expect(scriptsOf(0x2bc)).toEqual(['Bengali', 'Cyrillic', 'Devanagari', 'Latin', 'Lisu', 'Thai', 'Toto']);
  });

  it('uses explicit extension sets rather than adding implicit primary values', () => {
    expect(scriptsOf(0x30fc)).toEqual(['Hiragana', 'Katakana']);
    expect(scriptOf(0x30fc)).toBe('Common');
    expect(scriptsOf(0x342)).toEqual(['Greek']);
    expect(scriptOf(0x342)).toBe('Inherited');
    expect(scriptsOf(0x41)).toEqual(['Latin']);
    expect(scriptsOf(0x10ffff)).toEqual(['Unknown']);
  });

  it.each(['обʼєкт', 'пʼєса', 'звʼязок'])('does not invent foreign scripts in %s', text => {
    expect(scanText(text).findings).toEqual([]);
    expect(sanitize(text).text).toBe(text);
  });

  it.each(['paypаl', 'pаyʼpаl', 'а\u0342'])('retains actual cross-script lookalikes in %s', text => {
    expect(scanText(text).findings.some(f => f.rule === 'confusable')).toBe(true);
    expect(sanitize(text).text).toBe(text);
  });

  it('does not turn Arabic vowel alternatives into a cross-script collision', () => {
    // An unchanged Arabic corpus page has these two ordinary spellings.
    // DAMMA has Arabic/Syriac alternatives; both whole words resolve to Arabic.
    const text = 'يُعطى يُعطي';
    expect(scanText(text).findings).toEqual([]);
    expect(sanitize(text).text).toBe(text);
  });

  it('does not describe every alternative of a shared mark as present in the word', () => {
    const [finding] = scanText('а\u0307').findings;
    expect(finding?.message).toContain('incompatible choices for its shared characters');
    expect(finding?.message).not.toContain('Syriac');
  });

  it.each(['\u200c', '\u200d'])('does not use shared Latin accents to excuse %s', joiner => {
    for (const mark of ['\u0303', '\u0304', '\u0308']) {
      for (const text of [`a${mark}${joiner}${mark}b`, `a${joiner}${mark}b`, `a${mark}${joiner}b`]) {
        const [finding] = scanText(text).findings.filter(f => f.rule === 'invisible');
        expect(finding?.codePoints).toEqual([joiner.codePointAt(0)]);
        expect(sanitize(text).text).toBe(text.replace(joiner, ''));
      }
    }
  });

  it('preserves the established Persian, suffix and virama policies', () => {
    for (const text of ['می\u200cخواهم', 'token\u200cها', 'क्\u200dष', 'ന്\u200d']) {
      expect(scanText(text).findings.filter(f => f.rule === 'invisible')).toEqual([]);
      expect(sanitize(text).text).toBe(text);
    }
  });
});

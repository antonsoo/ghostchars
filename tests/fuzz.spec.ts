// sanitize() is meant to sit in front of an LLM as an input filter, so three things have to hold
// for any string, however hostile: it never throws; its output is clean by its own scanner (and
// so sanitizing twice changes nothing); and it only ever deletes hidden characters, never a
// visible one. The strings are random draws from the code points the rules care about.
import { describe, expect, it } from 'vitest';
import { reveal, sanitize, scanText } from '../src/core/index.js';
import { indexToPosition, positionIndex } from '../src/core/rules/position.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0) / 4294967296);
}
const CP = [
  0x61, 0x62, 0x20, 0x0a, 0x3b, 0x3a, 0x21, 0x3f, 0xab, 0xbb, 0x2f, 0x2a, 0x22, 0x27, 0x60,
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad, 0x180e, 0x34f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x2801, 0x28ff,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x61c,
  0xa0, 0x202f, 0x2000, 0x2003, 0x2028, 0x2029, 0x3000, 0x85, 0x1b, 0x00, 0x7f, 0x9b,
  0x94d, 0x915, 0x937, 0xd4d, 0xd28, 0x644, 0x627, 0x5d0, 0x1f468, 0x1f469, 0x1f466, 0x2764, 0xfe0f, 0xfe0e, 0xfe00,
  0xe0001, 0xe0020, 0xe0041, 0xe007f, 0xe0100, 0xe0101, 0xe01ef, 0x430, 0x435, 0x3bf, 0x1d5ba, 0xff41, 0x301, 0x308,
  0xd800, 0xdc00, 0xdfff, 0xfffd, 0x10ffff,
];
// The code points in CP that a reader can see: letters, punctuation, emoji, braille patterns,
// combining accents, the replacement character. None of these may ever be deleted.
const VISIBLE = new Set([0x61, 0x62, 0x3b, 0x3a, 0x21, 0x3f, 0xab, 0xbb, 0x2f, 0x2a, 0x22, 0x27, 0x60, 0x2801, 0x28ff, 0x915, 0x937, 0xd28, 0x644, 0x627, 0x5d0, 0x1f468, 0x1f469, 0x1f466, 0x2764, 0x430, 0x435, 0x3bf, 0x1d5ba, 0xff41, 0x301, 0x308, 0xfffd]);
const visible = (t: string): string => [...t].filter((c) => VISIBLE.has(c.codePointAt(0)!)).join('');
const FIXABLE = new Set(['bidi-control', 'bidi-mark', 'bidi-unbalanced', 'tag-smuggling', 'variation-selector-smuggling', 'variation-selector-stray', 'invisible', 'unusual-whitespace', 'control-character']);

it('fuzz: scan, sanitize and reveal on hostile strings', { timeout: 300_000 }, () => {
  const bad: string[] = [];
  let residual = 0, notIdempotent = 0;
  const show = (t: string) => [...t].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' ');
  for (let seed = 1; seed <= 4000 && bad.length < 10; seed++) {
    const r = rng(seed);
    const n = 1 + Math.floor(r() * 24);
    let text = '';
    for (let i = 0; i < n; i++) {
      const cp = CP[Math.floor(r() * CP.length)]!;
      text += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
    }
    try {
      const scan = scanText(text);
      for (const f of scan.findings) {
        if (!(f.start.offset >= 0 && f.end.offset <= text.length && f.start.offset < f.end.offset)) bad.push(`seed ${seed}: bad span ${f.rule} [${f.start.offset},${f.end.offset}) in ${show(text)}`);
      }
      reveal(text);
      const once = sanitize(text);
      const left = scanText(once.text).findings.filter((f) => f.fixable && FIXABLE.has(f.rule));
      if (left.length) {
        residual++;
        if (residual <= 4) bad.push(`seed ${seed}: after sanitize, still fixable: ${left.map((f) => f.rule).join(',')} | in: ${show(text)} | out: ${show(once.text)}`);
      }
      const twice = sanitize(once.text);
      if (twice.text !== once.text) notIdempotent++;
      if (visible(once.text) !== visible(text)) bad.push(`seed ${seed}: a visible character was removed | in: ${show(text)} | out: ${show(once.text)}`);
    } catch (err) {
      bad.push(`seed ${seed}: ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')} | in: ${show(text)}`);
    }
  }
  expect(bad).toEqual([]);
  expect([residual, notIdempotent]).toEqual([0, 0]);
});

describe('sanitize keeps the visible text', () => {
  it('removes a stray variation selector, not the character it follows', () => {
    expect(sanitize('ok\uFE00!').text).toBe('ok!');
    expect(sanitize('ab\u{E01EF} c').text).toBe('ab c');
    expect(sanitize('x;\uFE0E y').text).toBe('x; y');
  });

  it('strips smuggled selectors from an emoji and keeps the emoji', () => {
    const carrier = 'hi \u{1F600}\u{E0158}\u{E0159} there'; // selectors for the bytes of "hi"
    const result = sanitize(carrier);
    expect(result.text).toBe('hi \u{1F600} there');
    expect(result.fixed.map((f) => f.rule)).toEqual(['variation-selector-smuggling']);
    // The finding still points at the emoji, so a report shows where the payload hides.
    expect(scanText(carrier).findings[0]).toMatchObject({ start: { offset: 3 }, removal: { start: 5, end: 9 } });
  });

  it('leaves a registered emoji presentation sequence alone', () => {
    expect(sanitize('\u2764\uFE0F ok').text).toBe('\u2764\uFE0F ok');
  });

  it('rescans until clean: a joiner that was legitimate only next to a removed mark goes too', () => {
    // ZWNJ between an Arabic letter mark and an Arabic letter is a joining context; with the
    // mark removed it follows a colon, where it is just an invisible character.
    const text = ':\u061C\u200C\u0644';
    const result = sanitize(text);
    expect(result.text).toBe(':\u0644');
    expect(scanText(result.text).findings.filter((f) => f.fixable)).toEqual([]);
  });
});

describe('positions and scale', () => {
  // The straightforward definition: walk the text from its start.
  function positionByWalking(text: string, index: number): { line: number; column: number; offset: number } {
    let line = 1;
    let lastNewline = -1;
    for (let i = 0; i < index; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
        line++;
        lastNewline = i;
      }
    }
    return { line, column: index - lastNewline, offset: index };
  }

  it('the indexed position lookup agrees with walking the text', () => {
    const pieces = ['a', '\n', '\r', '\r\n', '\u{1f600}', ' ', '️'];
    for (let seed = 0; seed < 500; seed++) {
      const r = rng(seed);
      let text = '';
      for (let n = Math.floor(r() * 30); n > 0; n--) text += pieces[Math.floor(r() * pieces.length)];
      const at = positionIndex(text);
      for (let index = 0; index <= text.length; index++) {
        expect(at(index), `${JSON.stringify(text)} @ ${index}`).toEqual(positionByWalking(text, index));
        expect(indexToPosition(text, index)).toEqual(positionByWalking(text, index));
      }
    }
  });

  it('thirty thousand stray selectors are scanned and removed in well under a second each', () => {
    // Each finding used to rescan the text from its start for its line and column, and each
    // removal used to copy the rest of the text: 2.7 s to scan this and 3.6 s to sanitize it.
    const text = 'a︀'.repeat(30_000);
    let started = performance.now();
    expect(scanText(text).findings).toHaveLength(30_000);
    expect(performance.now() - started).toBeLessThan(1500);
    started = performance.now();
    expect(sanitize(text).text).toBe('a'.repeat(30_000));
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

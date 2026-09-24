import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';

describe('invisible / default-ignorable characters', () => {
  it('flags zero-width space', () => {
    const { findings } = scanText('pay​pal');
    expect(findings.some((f) => f.rule === 'invisible' && f.codePoints[0] === 0x200b)).toBe(true);
  });

  it('flags the Hangul filler backdoor characters', () => {
    const { findings } = scanText('adminᅟtrue');
    expect(findings.some((f) => f.rule === 'invisible' && f.codePoints[0] === 0x115f)).toBe(true);
  });

  it('does not flag a BOM at the very start of a file', () => {
    const { findings } = scanText('﻿const x = 1;');
    expect(findings.some((f) => f.codePoints[0] === 0xfeff)).toBe(false);
  });

  it('flags a BOM that appears mid-file', () => {
    const { findings } = scanText('const x = 1;﻿const y = 2;');
    expect(findings.some((f) => f.codePoints[0] === 0xfeff)).toBe(true);
  });

  it('allows ZWJ inside a real emoji ZWJ sequence (family emoji)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const { findings } = scanText(family);
    expect(findings.some((f) => f.rule === 'invisible')).toBe(false);
  });

  it('allows ZWNJ between Persian letters', () => {
    // می‌خواهم ("mikhāham") uses ZWNJ to separate the prefix "می" from "خواهم".
    const persian = 'می‌خواهم';
    const { findings } = scanText(persian);
    expect(findings.some((f) => f.rule === 'invisible')).toBe(false);
  });

  it('flags a ZWJ used between two plain Latin letters (not an emoji or joining script)', () => {
    const { findings } = scanText('ab‍cd');
    expect(findings.some((f) => f.rule === 'invisible' && f.codePoints[0] === 0x200d)).toBe(true);
  });
});

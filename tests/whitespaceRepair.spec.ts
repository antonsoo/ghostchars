import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { computeFix, formatDryRun } from '../src/cli/fix.js';
import { sanitize } from '../src/core/sanitize.js';

const JS_SPACES = [0xa0, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x202f, 0x205f, 0x3000];

describe('whitespace repair preserves native JavaScript boundaries', () => {
  it.each(JS_SPACES)('retains the return token boundary for U+%s', (cp) => {
    const source = `function allowed() { return${String.fromCodePoint(cp)}false; } allowed();`;
    const original = new Script(source).runInNewContext();
    const repaired = computeFix('check.mjs', source);
    expect(original).toBe(false);
    expect(new Script(repaired.newText).runInNewContext()).toBe(original);
    expect(repaired.newText).toBe('function allowed() { return false; } allowed();');
    expect(sanitize(repaired.newText, { mode: 'normalize' }).remaining).toEqual([]);
  });

  it.each([0x2028, 0x2029])('keeps code after a Unicode line-comment boundary U+%s', (cp) => {
    const source = `let denied = false; // check below${String.fromCodePoint(cp)}denied = true; denied;`;
    const original = new Script(source).runInNewContext();
    const repaired = computeFix('check.mjs', source);
    expect(original).toBe(true);
    expect(new Script(repaired.newText).runInNewContext()).toBe(original);
    expect(repaired.newText).toContain('below\ndenied = true;');
    const preview = formatDryRun(repaired, source);
    expect(preview).toContain('2: + denied = true; denied;');
  });

  it('does not erase equal-length replacements and keeps the explicit removal contract', () => {
    const source = 'please\u00a0do\u2003not';
    expect(sanitize(source).text).toBe('pleasedonot');
    expect(sanitize(source, { mode: 'remove' }).text).toBe('pleasedonot');
    expect(sanitize(source, { mode: 'normalize' }).text).toBe('please do not');
    expect(sanitize(source, { mode: 'keep' }).text).toBe(source);
  });

  it('keeps allowlists and disabled rules through normalization and later rescans', () => {
    const source = 'keep\u00a0space\u2003here:\u061c\u200c\u0644';
    const options = { allowCodePoints: [0xa0], severityOverrides: { invisible: false as const } };
    const result = sanitize(source, { mode: 'normalize', scanOptions: options });
    expect(result.text).toBe('keep\u00a0space here:\u200c\u0644');
    expect(sanitize(result.text, { mode: 'normalize', scanOptions: options }).text).toBe(result.text);
  });

  it('normalizes flagged NEL and braille blank without changing ordinary or protected text', () => {
    const source = 'line\u0085word\u2800gap ⠁\u2800⠃ «\u00a0bonjour\u00a0» 漢\u3000字';
    expect(sanitize(source, { mode: 'normalize' }).text).toBe('line\nword gap ⠁\u2800⠃ «\u00a0bonjour\u00a0» 漢\u3000字');
  });
});

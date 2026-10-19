import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { scanJavaScript } from '../src/javascript.js';
import type { JavaScriptSourceType } from '../src/javascript.js';

describe('parsed JavaScript names', () => {
  it.each([
    ['a', String.raw`\u0430`, '\u0430'],
    ['A', String.raw`\u{1D400}`, '\u{1d400}'],
    ['caf\u00e9', String.raw`cafe\u0301`, 'cafe\u0301'],
  ])('retains original ranges for %s and %s', (left, raw, decoded) => {
    const source = `// \u{1f52d}\r\nconst ${left} = 10; const ${raw} = 20; console.log([${left}, ${raw}]);`;
    const result = scanJavaScript(source);
    const findings = result.findings.filter(f => f.rule === 'confusable');
    expect(findings).toHaveLength(4);
    expect(findings.map(f => source.slice(f.start.offset, f.end.offset))).toEqual([left, raw, left, raw]);
    expect(findings.filter(f => f.decoded).map(f => f.decoded)).toEqual([decoded, decoded]);
    expect(findings.every(f => f.severity === 'error' && !f.fixable)).toBe(true);
    expect(findings.map(f => f.start.line)).toEqual([2, 2, 2, 2]);
    expect(findings[0]!.start.column).toBe(7);
    expect(result.codePointCount).toBe([...source].length);
  });

  it('compares decoded names, not alternative source spellings of one name', () => {
    for (const source of [
      String.raw`const \u0061 = 10; console.log(a, \u{61});`,
      'const \\u0430 = 10; console.log(\u0430, \\u{430});',
    ]) expect(scanJavaScript(source).findings).toEqual([]);
  });

  it('does not treat comments, strings, regex bodies or template text as names', () => {
    const source = 'const a = 10; // \u0430\\u0430\n' +
      'const text = "\u0430"; const pattern = /\u0430/; const template = `\u0430`;';
    expect(scanJavaScript(source).findings.filter(f => f.rule === 'confusable')).toEqual([]);
    const expression = source + 'const \\u0430 = 20; const nested = `${a + \\u0430}`;';
    expect(scanJavaScript(expression).findings.filter(f => f.rule === 'confusable')).toHaveLength(4);
  });

  it('keeps private names in their separate namespace and includes property names', () => {
    expect(scanJavaScript('const a = 10; class Box { #\\u0430 = 20; get() { return this.#\\u0430; } }').findings).toEqual([]);
    const source = 'class Box { #a = 10; #\\u0430 = 20; sum() { return this.#a + this.#\\u0430; } }';
    const findings = scanJavaScript(source).findings;
    expect(findings.map(f => source.slice(f.start.offset, f.end.offset))).toEqual(['#a', '#\\u0430', '#a', '#\\u0430']);
    expect(findings.filter(f => f.decoded).map(f => f.decoded)).toEqual(['#\u0430', '#\u0430']);
    expect(scanJavaScript('const box = { a: 10, \\u0430: 20 }; box.a + box.\\u0430;').findings).toHaveLength(4);
    expect(scanJavaScript('const box = { if: 10, \\u0456f: 20 }; box.if + box.\\u0456f;').findings.filter(f => f.severity === 'error')).toHaveLength(4);
    expect(scanJavaScript('const a = 10, \\u0430 = 20; const box = {a, \\u0430};').findings).toHaveLength(4);
  });

  it('retains raw-text rules and applies the same rule and scalar policy', () => {
    const source = 'const a = 10; const \\u0430 = 20; const text = "\u200b";';
    expect(scanJavaScript(source).findings.map(f => f.rule)).toEqual(['confusable', 'confusable', 'invisible']);
    const findings = scanJavaScript(source, {
      file: 'control.mjs', allowCodePoints: [0x61], severityOverrides: { confusable: 'info', invisible: false },
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', file: 'control.mjs', decoded: '\u0430' });
    expect(scanJavaScript(source, { severityOverrides: { confusable: false, invisible: false } }).findings).toEqual([]);
    const once = (function* () { yield 0x61; yield 0x430; yield 0x200b; })();
    expect(scanJavaScript(source, { allowCodePoints: once }).findings).toEqual([]);
  });

  it('uses the requested grammar and refuses invalid or unsupported syntax', () => {
    expect(() => scanJavaScript('return 10;')).toThrow();
    expect(() => scanJavaScript('return 10;', { sourceType: 'script' })).toThrow();
    expect(scanJavaScript('return 10;', { sourceType: 'commonjs' }).findings).toEqual([]);
    expect(scanJavaScript('<!-- legacy comment\nvar a = 10;', { sourceType: 'script' }).findings).toEqual([]);
    expect(() => scanJavaScript('<!-- legacy comment\nvar a = 10;')).toThrow();
    expect(() => scanJavaScript('const a: number = 10;')).toThrow();
    expect(() => scanJavaScript('const \\u002D = 10;')).toThrow();
    expect(() => scanJavaScript('const a = <div/>;')).toThrow();
    expect(() => scanJavaScript('const a = 10;', { sourceType: 'unknown' as JavaScriptSourceType })).toThrow(TypeError);
  });
});

describe('JavaScript CLI inspection', () => {
  it('retains valid findings but reports syntax gaps, without changing source or executing it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'ghostchars-js-'));
    try {
      const sentinel = join(folder, 'executed');
      const good = join(folder, 'good.mjs');
      const bad = join(folder, 'bad.mjs');
      const source = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad');\nconst a = 10; const \\u0430 = 20;`;
      writeFileSync(good, source);
      writeFileSync(bad, 'const value: number = 10;');
      const run = (...args: string[]) => spawnSync(process.execPath, ['dist/cli.js', '--no-config', ...args], { encoding: 'utf8' });
      const result = run(good, bad, '--javascript', 'module', '--format', 'json');
      expect(result.status).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.summary).toMatchObject({ complete: false, inputErrors: 1, total: 2 });
      expect(report.errors[0].path).toContain('bad.mjs');
      expect(report.results[0].findings[1].decoded).toBe('\u0430');
      expect(() => readFileSync(sentinel)).toThrow();
      expect(readFileSync(good, 'utf8')).toBe(source);
      for (const args of [
        [good, '--javascript', 'module', '--fix'],
        [good, '--javascript=module', '--code'],
        [good, '--javascript', 'typescript'],
        [good, '--javascript'],
        ['reveal', good, '--javascript', 'module'],
      ]) expect(run(...args).status).toBe(2);
      expect(readFileSync(good, 'utf8')).toBe(source);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

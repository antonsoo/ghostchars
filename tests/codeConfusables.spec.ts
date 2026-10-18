import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';
import { sanitize } from '../src/core/sanitize.js';
import { scanOptionsForFile } from '../src/cli/config.js';

interface NativeCase {
  name: string;
  file: string;
  left: string;
  right: string;
  skeleton: string;
}
const oracle = JSON.parse(readFileSync(new URL('../studies/code-confusables/results/oracle.json', import.meta.url), 'utf8')) as { cases: NativeCase[] };

describe('code confusables against native JS bindings and ICU skeletons', () => {
  it.each(oracle.cases)('$name', ({ file, left, right, skeleton }) => {
    const source = readFileSync(new URL(`../studies/code-confusables/${file}`, import.meta.url), 'utf8');
    expect(scanText(source).findings).toEqual([]);
    const findings = scanText(source, { isCode: true }).findings;
    expect(findings).toHaveLength(4);
    expect(findings.map(f => source.slice(f.start.offset, f.end.offset))).toEqual([left, right, left, right]);
    for (const finding of findings) {
      expect(finding).toMatchObject({ rule: 'confusable', severity: 'error', skeleton, fixable: false });
      const spelling = source.slice(finding.start.offset, finding.end.offset);
      expect(finding.codePoints).toEqual([...spelling].map(c => c.codePointAt(0)));
    }
    const clean = sanitize(source, { scanOptions: { isCode: true } });
    expect(clean).toEqual({ text: source, fixed: [], remaining: findings });
  });

  it('keeps ASCII-only, distinct skeletons and identical spellings quiet', () => {
    for (const text of ['a a', 'I l 1', 'rn m', 'a \u03b2', '\u03bb', '\u0430 \u0430', 'caf\u00e9 caf\u00e9']) {
      expect(scanText(text, { isCode: true }).findings).toEqual([]);
    }
  });

  it('does not suppress code collisions when many foreign words occur elsewhere', () => {
    const text = '\u0430\u0431 \u0432\u0433 \u0434\u0435 \u0436\u0437 \u0438\u0439 \u043a\u043b \u043c\u043d \u043e\u043f \u0440\u0441 \u0442\u0443 cope \u0441\u043e\u0440\u0435';
    expect(scanText(text).findings).toEqual([]);
    const errors = scanText(text, { isCode: true }).findings.filter(f => f.severity === 'error');
    expect(errors.map(f => text.slice(f.start.offset, f.end.offset))).toEqual(['cope', '\u0441\u043e\u0440\u0435']);
  });

  it('retains code mode after removing an unrelated invisible and honors rule overrides', () => {
    const text = 'a \u0430\u200b';
    const result = sanitize(text, { scanOptions: { isCode: true } });
    expect(result.text).toBe('a \u0430');
    expect(result.fixed.map(f => f.rule)).toEqual(['invisible']);
    expect(result.remaining.map(f => f.rule)).toEqual(['confusable', 'confusable']);
    expect(scanText(result.text, { isCode: true, severityOverrides: { confusable: false } }).findings).toEqual([]);
    expect(scanText(result.text, { isCode: true, allowCodePoints: [0x61] }).findings).toHaveLength(1);
  });

  it('resolves explicit code contexts in matching file order, including false overrides', () => {
    const config = { isCode: false, overrides: [
      { files: ['src/**'], isCode: true },
      { files: ['src/locales/**'], isCode: false },
    ] };
    expect(scanOptionsForFile(config, 'src/index.ts').isCode).toBe(true);
    expect(scanOptionsForFile(config, 'src/locales/uk.ts').isCode).toBe(false);
    expect(scanOptionsForFile(config, 'README.md').isCode).toBe(false);
  });
});

// Real writing mixes scripts. These cases come from scanning sixty real translated READMEs
// and book lists (Arabic, Hebrew, Persian, Japanese, Chinese, Korean, Russian and forty more
// languages): before 0.1.4 they produced 279 findings, nearly all of them on ordinary words.
// Every non-ASCII character in this file is written as an escape.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitize } from '../src/core/sanitize.js';
import { scanText } from '../src/core/scanText.js';

const rules = (text: string): string[] => scanText(text).findings.map((f) => f.rule);
const mixes = (text: string): boolean => scanText(text).findings.some((f) => f.rule === 'confusable' && f.message.includes('mixes scripts'));
const collides = (text: string): boolean => scanText(text).findings.some((f) => f.rule === 'confusable' && f.message.includes('visually confusable with'));

describe('mixed scripts: what UTS #39 allows', () => {
  it.each([
    ['a Latin term inside a Japanese word', 'JavaScript\u30a2\u30eb\u30b4\u30ea\u30ba\u30e0\u3068\u30c7\u30fc\u30bf\u69cb\u9020'],
    ['Latin, kanji and kana in one run', 'AVL\u30c4\u30ea\u30fc Dijkstra\u30a2\u30eb\u30b4\u30ea\u30ba\u30e0 \u72b6\u614b\u7a7a\u9593\u306eDFS\u30c8\u30e9\u30d0\u30fc\u30b5\u30eb'],
    ['a Korean particle on a Latin word', 'README\uc5d0 Kosaraju\uc758'],
    ['Latin inside Chinese', '\u5927O\u7b26\u53f7 AVL\u6a39 7\u4e2a\u7b80\u5355\u7684JS\u51fd\u6570'],
    ['an Arabic letter attached to a Latin term', '\u062aBig'],
    ['a Hebrew prefix on a Latin term', '\u05d1JavaScript \u05d4README'],
    ['Thai and Devanagari next to Latin', '\u0e20\u0e32\u0e29\u0e32Python \u0939\u093f\u0902\u0926\u0940HTML'],
  ])('%s', (_name, text) => {
    expect(mixes(text)).toBe(false);
  });

  it.each([
    ['LaTeX2 + epsilon', 'LaTeX2\u03b5'],
    ['pi r, delta t, micro-seconds', '\u03c0r \u0394t 10\u03bcs \u03a9m'],
    ['lambda before a kanji, pi inside a Japanese word', '\u03bb\u7d44 gons\u306b\u57fa\u3065\u304f\u8fd1\u4f3c\u03c0\u8a08\u7b97'],
  ])('a Greek letter used as a symbol imitates nothing: %s', (_name, text) => {
    expect(mixes(text)).toBe(false);
  });

  it('judges the words of a snake_case name or a URL slug one by one', () => {
    // Russian words and "Linux", "Python" joined by underscores, as in a wiki URL.
    const slug = '\u0410\u0441\u0441\u0435\u043c\u0431\u043b\u0435\u0440_\u0432_Linux_\u0434\u043b\u044f_\u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0438\u0441\u0442\u043e\u0432_C \u0423\u0447\u0435\u0431\u043d\u0438\u043a_Python_2';
    expect(mixes(slug)).toBe(false);
    // One of the words is itself a lookalike: Latin "paypal" with a Cyrillic a.
    expect(mixes('p\u0430ypal_login')).toBe(true);
  });
});

describe('mixed scripts: what is still reported', () => {
  it.each([
    ['Cyrillic a in a Latin word', 'p\u0430ypal'],
    ['Greek omicron in a Latin word', 'g\u03bfogle'],
    ['a Latin c opening a Russian word (found in a real book list)', 'c\u0435\u0442\u044c\u044e'],
    ['a Latin letter planted among Cyrillic letters that have no Latin double', '\u0436c\u0449'],
    ['a Cherokee letter that passes for A', '\u13aapple'],
    ['Cyrillic and Greek in one word', '\u03b1\u0431\u0432'],
  ])('%s', (_name, text) => {
    expect(mixes(text)).toBe(true);
  });
});

describe('two spellings with one skeleton', () => {
  it('does not report two ordinary words of one script', () => {
    // Hebrew "or" and a word ending in final nun: vav and final nun both reduce to "l".
    expect(collides('\u05d0\u05d5 \u05d0\u05df')).toBe(false);
  });

  it('reports a word and its cross-script lookalike', () => {
    // The Russian word with a Latin c, beside the real one.
    expect(collides('c\u0435\u0442\u044c\u044e \u0441\u0435\u0442\u044c\u044e')).toBe(true);
    expect(collides('const paypal = 1; const p\u0430ypal = 2;')).toBe(true);
  });

  it('reports a Latin lookalike that never leaves the Latin script', () => {
    // "admin" with a dotless i.
    expect(collides('admin adm\u0131n')).toBe(true);
  });
});

describe('a doubled emoji presentation selector', () => {
  const heart = '\u2764\ufe0f'; // heavy black heart + VS16: the registered emoji sequence
  const doubled = `made with ${heart}\ufe0f by`;

  it('leaves the registered sequence alone', () => {
    expect(rules(`made with ${heart} by`)).toEqual([]);
  });

  it('reports the extra selector, and says what it is', () => {
    const { findings } = scanText(doubled);
    expect(findings.map((f) => f.rule)).toEqual(['variation-selector-stray']);
    expect(findings[0]!.message).toMatch(/^1 extra variation selector after U\+2764 .* and the selector that already picks its presentation/);
    expect(findings[0]!.message).not.toContain('no registered variation sequence');
  });

  it('is fixed by removing the extra one only: the emoji keeps its presentation', () => {
    expect(sanitize(doubled).text).toBe(`made with ${heart} by`);
  });

  it('still reads a payload hidden after an emoji as a payload', () => {
    const payload = [...new TextEncoder().encode('hi there')].map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16))).join('');
    const { findings } = scanText(`\u2764${payload}`);
    expect(findings.map((f) => f.rule)).toEqual(['variation-selector-smuggling']);
    expect(findings[0]!.decoded).toBe('hi there');
  });
});

describe('the ideographic space', () => {
  it('is ordinary in Chinese, Japanese and Korean text', () => {
    // A title and its volume number; a paragraph indented by two of them.
    expect(rules('\u8457\u4f5c\u9078\u96c6\u3000\uff11')).toEqual([]);
    expect(rules('\u3000\u3000\u6587\u7ae0\u306e\u59cb\u307e\u308a')).toEqual([]);
  });

  it('is still unusual between Latin words', () => {
    expect(rules('const\u3000x = 1;')).toEqual(['unusual-whitespace']);
  });
});

describe('the command line', () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

  it('writes a long report whole to a pipe', () => {
    // 3,000 findings: 2.2 MB of JSON. Until 0.1.4 the process exited with the output still
    // in flight, and a pipe (a CI log, `| jq`) got its first 65,536 bytes.
    const dir = mkdtempSync(join(tmpdir(), 'ghostchars-pipe-'));
    try {
      const file = join(dir, 'many.txt');
      writeFileSync(file, Array.from({ length: 3000 }, (_, i) => `line ${i} has a zero\u200bwidth space\n`).join(''));
      for (const format of ['json', 'sarif', 'github', 'pretty']) {
        const piped = spawnSync(process.execPath, [cli, file, '--format', format], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        expect(piped.status).toBe(0);
        expect(piped.stdout.length).toBeGreaterThan(500_000);
        if (format === 'json') expect(JSON.parse(piped.stdout).results[0].findings).toHaveLength(3000);
        if (format === 'sarif') expect(JSON.parse(piped.stdout).runs[0].results).toHaveLength(3000);
        if (format === 'github') expect(piped.stdout.trimEnd().split('\n')).toHaveLength(3000);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a path that does not exist instead of reporting "no findings"', () => {
    const run = spawnSync(process.execPath, [cli, 'no-such-directory', '--format', 'json'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no such file or directory: no-such-directory');
    expect(run.stdout).toBe('');
    // A real path beside it does not rescue the command.
    const mixed = spawnSync(process.execPath, [cli, 'src', 'scr'], { encoding: 'utf8' });
    expect(mixed.status).toBe(2);
    expect(execFileSync(process.execPath, [cli, 'src'], { encoding: 'utf8' })).toContain('no findings');
  });
});

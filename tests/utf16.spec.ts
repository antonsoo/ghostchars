import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeFile, encodeFile } from '../src/cli/encoding.js';
import { main } from '../src/cli/index.js';
import { discoverFiles } from '../src/cli/walk.js';
import { scanText } from '../src/core/index.js';

// A file saved as UTF-16 with a byte-order mark (PowerShell ISE scripts, .reg files, anything
// redirected with `>` in Windows PowerShell) used to be skipped as "binary", with exit code 0.

const trojan = readFileSync(new URL('../examples/trojan-source.c', import.meta.url), 'utf8');

function captured<T>(fn: () => T): { result: T; out: string } {
  const original = console.log;
  let out = '';
  console.log = (...args: unknown[]) => {
    out += `${args.join(' ')}\n`;
  };
  try {
    return { result: fn(), out };
  } finally {
    console.log = original;
  }
}

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ghostchars-utf16-'));
  cwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

describe.each(['utf-16le', 'utf-16be'] as const)('a %s file', (encoding) => {
  it('round-trips through decodeFile and encodeFile', () => {
    const bytes = encodeFile(trojan, encoding);
    expect([bytes[0], bytes[1]]).toEqual(encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]);
    expect(decodeFile(bytes)).toEqual({ text: trojan, encoding });
  });

  it('is scanned, with the findings of its UTF-8 twin', () => {
    writeFileSync('trojan.c', trojan, 'utf8');
    writeFileSync('trojan16.c', encodeFile(trojan, encoding));
    const { files, skipped } = discoverFiles(['.'], dir);
    expect(skipped).toEqual([]);
    expect(files.map((f) => f.path).sort()).toEqual(['trojan.c', 'trojan16.c']);

    const expected = scanText(trojan).findings.map((f) => [f.rule, f.start.line, f.start.column]);
    expect(expected.length).toBeGreaterThan(0);
    const { result: code, out } = captured(() => main(['trojan16.c', '--format', 'json', '--no-config']));
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      skipped: unknown[];
      results: Array<{ path: string; findings: Array<{ rule: string; start: { line: number; column: number } }> }>;
    };
    expect(report.skipped).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]!.findings.map((f) => [f.rule, f.start.line, f.start.column])).toEqual(expected);
  });

  it('is fixed in place and stays in its encoding', () => {
    const dirty = 'let a = 1;\u200b\r\nlet b = 2;\r\n';
    writeFileSync('fixme.js', encodeFile(dirty, encoding));
    captured(() => main(['fixme.js', '--fix', '--no-config']));
    expect(decodeFile(readFileSync('fixme.js'))).toEqual({ text: 'let a = 1;\r\nlet b = 2;\r\n', encoding });
  });
});

describe('what is still binary', () => {
  it('a UTF-16 mark followed by control bytes, and UTF-32', () => {
    writeFileSync('noise.bin', Buffer.from([0xff, 0xfe, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00]));
    const utf32 = Buffer.alloc(4 + 4 * 3);
    utf32.writeUInt32LE(0xfeff, 0);
    [...'abc'].forEach((ch, i) => utf32.writeUInt32LE(ch.codePointAt(0)!, 4 + i * 4));
    writeFileSync('wide.txt', utf32);
    const { files, skipped } = discoverFiles(['.'], dir);
    expect(files).toEqual([]);
    expect(skipped.map((s) => [s.path, s.reason]).sort()).toEqual([
      ['noise.bin', 'binary'],
      ['wide.txt', 'binary'],
    ]);
  });
});

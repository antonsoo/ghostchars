import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeFile, encodeFile } from '../src/cli/encoding.js';
import { main } from '../src/cli/index.js';
import { discoverFiles } from '../src/cli/walk.js';

let dir: string;
let cwd: string;
beforeEach(() => { cwd = process.cwd(); dir = mkdtempSync(join(tmpdir(), 'ghostchars-repair-')); process.chdir(dir); });
afterEach(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });

function captured(args: string[]) {
  const log = console.log;
  const error = console.error;
  let out = '';
  let err = '';
  console.log = (...parts: unknown[]) => { out += parts.join(' ') + '\n'; };
  console.error = (...parts: unknown[]) => { err += parts.join(' ') + '\n'; };
  try { return { code: main(args), get out() { return out; }, get err() { return err; } }; }
  finally { console.log = log; console.error = error; }
}

describe('configured file repairs', () => {
  it('does not repair with defaults when an explicit config path is missing', () => {
    writeFileSync('keep.txt', 'a\u200bb');
    const result = captured(['keep.txt', '--fix', '--config', 'missing.json']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Config file does not exist');
    expect(readFileSync('keep.txt', 'utf8')).toBe('a\u200bb');
  });

  it.each([
    null,
    [],
    { rules: { invisble: false } },
    { rules: { invisible: 'off' } },
    { allow: ['U+110000'] },
    { allow: ['U+D800'] },
    { allow: [1.2] },
    { allow: [true] },
    { overrides: [{ files: '*.txt', rules: { invisible: false } }] },
    { overrides: [{ files: ['*.txt'], allow: ['U+200B'], rule: {} }] },
  ])('rejects malformed policy before touching source: %j', (config) => {
    writeFileSync('.ghostcharsrc.json', JSON.stringify(config));
    writeFileSync('keep.txt', 'a\u200bb');
    expect(captured(['keep.txt', '--fix']).code).toBe(2);
    expect(readFileSync('keep.txt', 'utf8')).toBe('a\u200bb');
  });

  it.each(['utf-8', 'utf-16le', 'utf-16be'] as const)('honors file overrides and preserves %s bytes, BOMs and line endings', (encoding) => {
    const text = '\uFEFFa\u200bb \u202Eok\u202C\r\nprice\u00A0USD\rnext\n';
    const expected = '\uFEFFa\u200bb ok\r\nprice\u00A0USD\rnext\n';
    writeFileSync('.ghostcharsrc.json', JSON.stringify({ overrides: [{ files: ['*.txt'], rules: { invisible: false }, allow: ['U+00A0'] }] }));
    const original = encodeFile(text, encoding);
    writeFileSync('keep.txt', original);
    const preview = captured(['keep.txt', '--fix', '--dry-run']);
    expect(preview.code).toBe(1);
    expect(preview.out).toContain('+ \\u{FEFF}a⟦U+200B ZWSP⟧b ok');
    expect(readFileSync('keep.txt')).toEqual(original);
    expect(captured(['keep.txt', '--fix', '--format', 'json']).code).toBe(1);
    expect(readFileSync('keep.txt')).toEqual(encodeFile(expected, encoding));
    // Exit codes for a fix describe the findings from the original scan. A rescan is clean.
    expect(captured(['keep.txt', '--format', 'json']).code).toBe(0);
  });

  it.each([
    ['invalid UTF-8', Buffer.from([0x61, 0xff, 0xe2, 0x80, 0x8b])],
    ['truncated UTF-8', Buffer.from([0x61, 0xe2, 0x80, 0x8b, 0xc3])],
    ['odd UTF-16LE', Buffer.from([0xff, 0xfe, 0x61, 0, 0x0b, 0x20, 0x62])],
    ['unpaired UTF-16BE', Buffer.from([0xfe, 0xff, 0, 0x61, 0x20, 0x0b, 0xd8, 0])],
  ])('refuses lossy repair of %s', (_label, bytes) => {
    writeFileSync('broken.txt', bytes);
    const result = captured(['broken.txt', '--fix', '--format', 'json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.out).skipped[0].reason).toContain('Invalid utf-');
    expect(readFileSync('broken.txt')).toEqual(bytes);
    const preview = captured(['broken.txt', '--fix', '--dry-run']);
    expect(preview.code).toBe(2);
    expect(preview.err).toContain('Invalid utf-');
    expect(preview.out).not.toContain('nothing to fix');
  });

  it('accepts a literal encoded replacement character without fabricating one', () => {
    const text = 'replacement \uFFFD; invisible \u200b';
    writeFileSync('literal.txt', text);
    expect(captured(['literal.txt', '--fix']).code).toBe(0);
    expect(readFileSync('literal.txt', 'utf8')).toBe('replacement \uFFFD; invisible ');
  });

  it.each(['utf-16le', 'utf-16be'] as const)('keeps text when the discovery sample ends halfway through a %s surrogate pair', (encoding) => {
    const text = 'a'.repeat(4094) + '\u{1F600}\u200b';
    writeFileSync('boundary.txt', encodeFile(text, encoding));
    expect(discoverFiles(['boundary.txt'], dir).skipped).toEqual([]);
    captured(['boundary.txt', '--fix']);
    expect(decodeFile(readFileSync('boundary.txt')).text).toBe('a'.repeat(4094) + '\u{1F600}');
  });
});

describe('diagnostic boundaries', () => {
  it('reveal exposes a legitimate joiner without changing the source file', () => {
    const text = '\u0627\u200D\u0628\r\nnext\n';
    writeFileSync('arabic.txt', text);
    const result = captured(['reveal', 'arabic.txt']);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain('\u200D');
    expect(result.out).toContain('\\u{200D}');
    expect(result.out).toContain('\nnext\n');
    expect(readFileSync('arabic.txt', 'utf8')).toBe(text);
  });

  it.each(['pretty', 'summary'])('%s escapes filenames instead of executing their terminal controls', (format) => {
    const name = 'log\u001B[2J\n\u202E.txt';
    writeFileSync(name, 'a\u200bb');
    const result = captured([name, '--format', format]);
    expect(result.out).not.toContain('\u001B');
    expect(result.out).not.toContain('\u202E');
    expect(result.out).toContain('log\\u{001B}[2J\\u{000A}\\u{202E}.txt');
  });

  it('escapes GitHub annotation property delimiters and newlines in the source filename', () => {
    const name = 'a,b:100%\n::error::forged.txt';
    writeFileSync(name, 'a\u202Eb');
    const result = captured([name, '--format', 'github']);
    expect(result.out).toContain('file=a%2Cb%3A100%25%0A%3A%3Aerror%3A%3Aforged.txt,line=1');
    expect(result.out.split('\n').filter((line) => line === '::error::forged.txt')).toEqual([]);
  });

  it('escapes missing-path errors and retains skipped-file information in summary reports', () => {
    expect(captured(['missing\u001B[2J']).err).toContain('missing\\u{001B}[2J');
    writeFileSync('bad.txt', Buffer.from([0xff]));
    const result = captured(['bad.txt', '--format', 'summary']);
    expect(result.code).toBe(2);
    expect(result.out).toContain('skipped 1 file(s): bad.txt (read error: Invalid utf-8');
  });
});

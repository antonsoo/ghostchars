import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/index.js';
import { discoverFiles } from '../src/cli/walk.js';
import { loadConfig, scanOptionsForFile } from '../src/cli/config.js';

let dir: string;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ghostchars-cli-'));
  originalCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('discoverFiles', () => {
  it('skips node_modules and respects a plain .gitignore outside a git repo', () => {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'ok');
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(dir, 'ignored.txt'), 'ok');
    writeFileSync(join(dir, 'kept.txt'), 'ok');

    const { files } = discoverFiles(['.'], dir);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['.gitignore', 'kept.txt']);
  });

  it('skips oversized and binary files with a reason', () => {
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 0]));
    const { files, skipped } = discoverFiles(['.'], dir);
    expect(files.some((f) => f.path === 'binary.bin')).toBe(false);
    expect(skipped.find((s) => s.path === 'binary.bin')?.reason).toBe('binary');
  });
});

describe('config', () => {
  it('applies per-glob severity overrides and allowlists', () => {
    writeFileSync(
      join(dir, '.ghostcharsrc.json'),
      JSON.stringify({
        rules: { 'unusual-whitespace': 'warning' },
        overrides: [{ files: ['examples/**'], rules: { 'bidi-control': false }, allow: ['U+200B'] }],
      }),
    );
    const config = loadConfig(dir);
    const rootOpts = scanOptionsForFile(config, 'src/index.ts');
    expect(rootOpts.severityOverrides?.['bidi-control']).toBeUndefined();

    const exampleOpts = scanOptionsForFile(config, 'examples/trojan.c');
    expect(exampleOpts.severityOverrides?.['bidi-control']).toBe(false);
    expect([...(exampleOpts.allowCodePoints as Set<number>)]).toContain(0x200b);
  });
});

describe('main() end-to-end', () => {
  it('exits 1 when error-level findings are present', () => {
    writeFileSync(join(dir, 'bad.js'), 'const a = 1;‮// rlo');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = main(['bad.js', '--format', 'json']);
    logSpy.mockRestore();
    expect(code).toBe(1);
  });

  it('exits 0 for clean input', () => {
    writeFileSync(join(dir, 'good.js'), 'const a = 1;\n');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = main(['good.js']);
    logSpy.mockRestore();
    expect(code).toBe(0);
  });

  it('--fix removes fixable findings in place', () => {
    writeFileSync(join(dir, 'fixme.js'), 'a​b');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    main(['fixme.js', '--fix']);
    logSpy.mockRestore();
    const after = readFileSync(join(dir, 'fixme.js'), 'utf8');
    expect(after).toBe('ab');
  });
});

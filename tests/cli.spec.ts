import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/index.js';
import { discoverFiles } from '../src/cli/walk.js';
import { loadConfig, scanOptionsForFile } from '../src/cli/config.js';

// vi.spyOn(console, ...) does not reliably intercept calls made from other
// modules in this Node/Vitest combination, so CLI output is suppressed by
// direct, restored reassignment instead -- these tests care about exit
// codes and file effects, not what got printed.
function withSilencedConsole<T>(fn: () => T): T {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

let dir: string;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ghostchars-cli-'));
  originalCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
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

describe.skipIf(process.platform === 'win32')('literal Git directory scopes', () => {
  it.each([
    [':victim', 'victim'],
    [':(glob)docs*', 'docs-old'],
    [':(exclude)draft', 'production'],
    ['docs*', 'docs-old'],
    ['packages/docs*', 'packages/docs-old'],
    ['[id]', 'i'],
  ])('scans and repairs only the existing %s directory', (scope, sibling) => {
    execFileSync('git', ['init', '-q', dir]);
    const original = 'const value = 1; // \u202e reversed\n';
    mkdirSync(join(dir, scope), { recursive: true });
    mkdirSync(join(dir, sibling), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'ignored.js\n');
    for (const file of ['tracked.js', 'untracked.js', 'ignored.js']) writeFileSync(join(dir, scope, file), original);
    writeFileSync(join(dir, sibling, 'outside.js'), original);
    execFileSync('git', ['--literal-pathspecs', 'add', '--', `${scope}/tracked.js`, `${sibling}/outside.js`]);

    const found = discoverFiles([scope], dir);
    expect(found.errors).toEqual([]);
    expect(found.files.map((file) => file.path).sort()).toEqual([`${scope}/tracked.js`, `${scope}/untracked.js`]);
    expect(withSilencedConsole(() => main([scope, '--fix', '--no-config']))).toBe(1);
    for (const file of ['tracked.js', 'untracked.js']) expect(readFileSync(join(dir, scope, file), 'utf8')).toBe(original.replace('\u202e', ''));
    expect(readFileSync(join(dir, scope, 'ignored.js'), 'utf8')).toBe(original);
    expect(readFileSync(join(dir, sibling, 'outside.js'), 'utf8')).toBe(original);
  });

  it.each(['GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'])('ignores inherited %s for literal enumeration', (variable) => {
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, ':victim'));
    writeFileSync(join(dir, ':victim', 'input.js'), 'text');
    vi.stubEnv(variable, '1');
    vi.stubEnv('GIT_LITERAL_PATHSPECS', '0');
    const found = discoverFiles([':victim'], dir);
    expect(found.errors).toEqual([]);
    expect(found.files.map((file) => file.path)).toEqual([':victim/input.js']);
    expect(process.env[variable]).toBe('1');
    expect(process.env.GIT_LITERAL_PATHSPECS).toBe('0');
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
    const code = withSilencedConsole(() => main(['bad.js', '--format', 'json']));
    expect(code).toBe(1);
  });

  it('exits 0 for clean input', () => {
    writeFileSync(join(dir, 'good.js'), 'const a = 1;\n');
    const code = withSilencedConsole(() => main(['good.js']));
    expect(code).toBe(0);
  });

  it('--fix removes fixable findings in place', () => {
    writeFileSync(join(dir, 'fixme.js'), 'a​b');
    withSilencedConsole(() => main(['fixme.js', '--fix']));
    const after = readFileSync(join(dir, 'fixme.js'), 'utf8');
    expect(after).toBe('ab');
  });

  it('exits 2 (not a crash) on a malformed config file, with a clear message', () => {
    writeFileSync(join(dir, 'good.js'), 'const a = 1;\n');
    writeFileSync(join(dir, '.ghostcharsrc.json'), '{not valid json');
    // loadConfig() itself is the unit under test for the message; main()'s
    // job is just to catch it and return a clean exit code instead of
    // letting the exception escape as an uncaught stack trace.
    expect(() => loadConfig(dir)).toThrowError(/Failed to parse/);
    let code = -1;
    expect(() => {
      code = withSilencedConsole(() => main(['good.js']));
    }).not.toThrow();
    expect(code).toBe(2);
  });

  it('scans an empty file, and refuses a path that is not there', () => {
    writeFileSync(join(dir, 'empty.js'), '');
    expect(withSilencedConsole(() => main(['empty.js']))).toBe(0);
    // Exit 2, the usage-error code: a check that scanned nothing must not pass.
    expect(withSilencedConsole(() => main(['empty.js', 'does-not-exist.js']))).toBe(2);
  });
});

describe('version', () => {
  it('matches package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const { VERSION } = await import('../src/cli/version.js');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

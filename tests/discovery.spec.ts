import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli/index.js';
import { discoverFiles } from '../src/cli/walk.js';

let root: string;
let cwd: string;
const payload = 'a\u202eb\u202c';
beforeEach(() => { cwd = process.cwd(); root = mkdtempSync(join(tmpdir(), 'ghostchars-discovery-')); process.chdir(root); });
afterEach(() => { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); });

function run(args: string[]) {
  const log = console.log, error = console.error;
  let stdout = '', stderr = '';
  console.log = (...parts: unknown[]) => { stdout += parts.join(' ') + '\n'; };
  console.error = (...parts: unknown[]) => { stderr += parts.join(' ') + '\n'; };
  try { return { code: main([...args, '--no-config']), stdout, stderr }; }
  finally { console.log = log; console.error = error; }
}

// Real filesystem failures; root/Windows cannot establish this chmod scenario.
const permissionsWork = process.platform !== 'win32' && process.getuid?.() !== 0;
describe.skipIf(!permissionsWork)('incomplete filesystem reads', () => {
  it.each(['pretty', 'summary', 'json', 'sarif', 'github'])('%s retains an unreadable input and never reports success', (format) => {
    writeFileSync('denied.txt', payload);
    chmodSync('denied.txt', 0);
    try {
      const result = run(['denied.txt', '--format', format]);
      expect(result.code).toBe(2);
      expect(result.stdout).toContain('denied.txt');
      expect(result.stdout).toContain('EACCES');
      expect(result.stdout).not.toContain('no findings');
      if (format === 'json') {
        const report = JSON.parse(result.stdout);
        expect(report.summary.complete).toBe(false);
        expect(report.summary.files).toBe(0);
        expect(report.summary.inputErrors).toBe(1);
        expect(report.skipped).toEqual([]);
      } else if (format === 'sarif') {
        const invocation = JSON.parse(result.stdout).runs[0].invocations[0];
        expect(invocation.executionSuccessful).toBe(false);
        expect(invocation.toolExecutionNotifications[0].level).toBe('error');
      } else if (format === 'github') expect(result.stdout).toContain('::error file=denied.txt,');
    } finally { chmodSync('denied.txt', 0o600); }
    expect(readFileSync('denied.txt', 'utf8')).toBe(payload);
  });

  it('keeps a directory traversal failure, including when no candidate file was found', () => {
    mkdirSync('private'); writeFileSync('private/hidden.txt', payload); chmodSync('private', 0);
    try {
      const result = discoverFiles(['.']);
      expect(result.files).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe('private');
      expect(run(['.', '--format', 'json']).code).toBe(2);
    } finally { chmodSync('private', 0o700); }
  });

  it('cannot repair with an unreadable ignore policy or unreadable sibling', () => {
    writeFileSync('good.txt', payload);
    writeFileSync('.gitignore', 'good.txt\n'); chmodSync('.gitignore', 0);
    try {
      const result = run(['.', '--fix', '--format', 'json']);
      expect(result.code).toBe(2);
      expect(result.stdout).toContain('could not read ignore policy');
      expect(result.stderr).toContain('no files were repaired');
    } finally { chmodSync('.gitignore', 0o600); }
    expect(readFileSync('good.txt', 'utf8')).toBe(payload);
  });
});

describe.skipIf(process.platform === 'win32')('symbolic links', () => {
  for (const git of [false, true]) {
    it(`${git ? 'git' : 'plain'} directory discovery lists links without reading or modifying their targets`, () => {
      mkdirSync('repo');
      writeFileSync('outside.txt', payload);
      symlinkSync('../outside.txt', 'repo/link.txt');
      symlinkSync('../absent.txt', 'repo/broken.txt');
      symlinkSync('..', 'repo/directory');
      writeFileSync('repo/ordinary.txt', payload);
      if (git) {
        execFileSync('git', ['init', '-q', '-b', 'main', 'repo']);
        execFileSync('git', ['-C', 'repo', 'add', '.']);
      }
      process.chdir(join(root, 'repo'));
      const result = run(['.', '--fix', '--format', 'json']);
      expect(result.code).toBe(1); // ordinary.txt has bidi findings
      const report = JSON.parse(result.stdout);
      expect(report.summary.complete).toBe(true);
      expect(report.summary.files).toBe(1);
      expect(report.skipped).toHaveLength(3);
      expect(report.skipped.every((s: { reason: string }) => s.reason === 'symbolic link (not followed)')).toBe(true);
      expect(readFileSync('../outside.txt', 'utf8')).toBe(payload);
      expect(readFileSync('ordinary.txt', 'utf8')).toBe('ab');
    });
  }

  it.each(['alias', 'directory', 'directory/outside.txt'])('explicit %s is refused, including link ancestors', (target) => {
    mkdirSync('real'); writeFileSync('real/outside.txt', payload);
    symlinkSync('real/outside.txt', 'alias'); symlinkSync('real', 'directory');
    const result = run([target, '--fix', '--format', 'json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).summary.complete).toBe(false);
    expect(readFileSync('real/outside.txt', 'utf8')).toBe(payload);
  });

  it('does not follow a tracked directory that was replaced by a link', () => {
    mkdirSync('repo/tree', { recursive: true }); mkdirSync('outside');
    writeFileSync('repo/tree/file.txt', 'original'); writeFileSync('outside/file.txt', payload);
    execFileSync('git', ['init', '-q', '-b', 'main', 'repo']); execFileSync('git', ['-C', 'repo', 'add', '.']);
    rmSync('repo/tree', { recursive: true }); symlinkSync('../outside', 'repo/tree');
    process.chdir(join(root, 'repo'));
    const result = run(['.', '--fix', '--format', 'json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).skipped).toEqual([
      { path: 'tree', reason: 'symbolic link (not followed)' },
      { path: 'tree/file.txt', reason: 'symbolic link (not followed)' },
    ]);
    expect(readFileSync('../outside/file.txt', 'utf8')).toBe(payload);
  });
});

it('a corrupt Git index is a discovery error, not a switch to a different file-selection policy', () => {
  execFileSync('git', ['init', '-q', '-b', 'main']);
  writeFileSync('good.txt', payload); writeFileSync('.git/index', 'not a git index');
  const result = run(['.', '--fix', '--format', 'json']);
  expect(result.code).toBe(2);
  expect(result.stdout).toContain('could not enumerate git files');
  expect(readFileSync('good.txt', 'utf8')).toBe(payload);
});

it.each(['missing', 'invalid-encoding'])('%s cannot leave an earlier valid file already repaired', (kind) => {
  writeFileSync('a-good.txt', payload);
  if (kind === 'invalid-encoding') writeFileSync('z-bad.txt', Buffer.from([0xff]));
  const result = run(['a-good.txt', 'z-bad.txt', '--fix', '--format', 'json']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('no files were repaired');
  expect(readFileSync('a-good.txt', 'utf8')).toBe(payload);
});

it('reports intentional binary exclusions separately from input failures', () => {
  writeFileSync('binary.bin', Buffer.from([0, 1, 0, 2])); writeFileSync('ok.txt', 'hello');
  const result = run(['.', '--format', 'json']);
  expect(result.code).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.errors).toEqual([]);
  expect(report.summary.complete).toBe(true);
  expect(report.summary.files).toBe(1);
  expect(report.skipped).toEqual([{ path: 'binary.bin', reason: 'binary' }]);
});

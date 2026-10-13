import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import type * as Fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { main } from '../src/cli/index.js';
import { prepareReportOutput } from '../src/cli/writeReport.js';

const faults = vi.hoisted(() => ({ partialWrite: false, flush: false, rename: false }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (faults.partialWrite && typeof args[0] === 'number') {
        fs.writeSync(args[0], 'part');
        throw new Error('ENOSPC after a real partial write');
      }
      return fs.writeFileSync(...args);
    },
    fsyncSync: (...args: Parameters<typeof fs.fsyncSync>) => {
      if (faults.flush) throw new Error('EIO during flush');
      return fs.fsyncSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (faults.rename) throw new Error('EACCES during replacement');
      return fs.renameSync(...args);
    },
  };
});

let root: string;
let cwd: string;
const original = 'const value = 1; // \u202e reversed\n';
beforeEach(() => {
  cwd = process.cwd(); root = mkdtempSync(join(tmpdir(), 'ghostchars-output-')); process.chdir(root);
  Object.assign(faults, { partialWrite: false, flush: false, rename: false });
  writeFileSync('source.js', original);
});
afterEach(() => { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); });

function run(args: string[]) {
  const log = console.log, error = console.error;
  let stdout = '', stderr = '';
  console.log = (text: string) => { stdout += text + '\n'; };
  console.error = (text: string) => { stderr += text + '\n'; };
  try { return { code: main(args), stdout, stderr }; }
  finally { console.log = log; console.error = error; }
}

it.skipIf(process.platform === 'win32').each(['source.js', './source.js', 'alias.js', 'alias-dir/source.js'])('refuses output alias %s before --fix changes inputs', output => {
  if (output === 'alias.js') linkSync('source.js', 'alias.js');
  if (output === 'alias-dir/source.js') symlinkSync('.', 'alias-dir', 'dir');
  const result = run(['source.js', '--fix', '--output', output]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('overlaps an input');
  expect(readFileSync('source.js', 'utf8')).toBe(original);
});

it('refuses an explicitly consumed config even when it is outside the scan', () => {
  writeFileSync('config.json', '{}');
  const result = run(['source.js', '--config', 'config.json', '--output', 'config.json']);
  expect(result.code).toBe(2);
  expect(readFileSync('config.json', 'utf8')).toBe('{}');
});

it.each(['json', 'sarif', 'github', 'summary', 'pretty'])('%s file output retains the stdout report and finding exit code', format => {
  const normalize = (text: string): string => {
    if (format === 'json') {
      const report = JSON.parse(text); delete report.summary.durationMs;
      return JSON.stringify(report);
    }
    return text.replace(/\d+(?:\.\d+)?ms/g, '<duration>');
  };
  const direct = run(['source.js', '--format', format]);
  const result = run(['source.js', '--format', format, '--output', 'report']);
  expect(result).toEqual({ code: 1, stdout: '', stderr: '' });
  expect(normalize(readFileSync('report', 'utf8'))).toBe(normalize(direct.stdout));
  if (process.platform !== 'win32') expect(statSync('report').mode & 0o777).toBe(0o600);
  expect(readFileSync('source.js', 'utf8')).toBe(original);
});

it('keeps incomplete input evidence in the report with exit 2', () => {
  const result = run(['source.js', 'missing.js', '--format', 'json', '--output', 'report.json']);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  const report = JSON.parse(readFileSync('report.json', 'utf8'));
  expect(report.summary.complete).toBe(false);
  expect(report.errors[0].path).toBe('missing.js');
});

it.each([false, true])('routes --fix preview=%s to the report without losing original findings', dryRun => {
  const result = run(['source.js', '--fix', ...(dryRun ? ['--dry-run'] : []), '--format', 'json', '--output', 'report']);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(readFileSync('source.js', 'utf8')).toBe(dryRun ? original : original.replace('\u202e', ''));
  const report = readFileSync('report', 'utf8');
  if (dryRun) expect(report).toContain('source.js');
  else expect(JSON.parse(report).summary.error).toBe(2);
});

it.each(['partialWrite', 'flush', 'rename'] as const)('%s failure retains the entire previous report and removes staging files', failure => {
  writeFileSync('report', 'complete previous report');
  faults[failure] = true;
  const result = run(['source.js', '--format', 'json', '--output', 'report']);
  expect(result.code).toBe(2);
  expect(readFileSync('report', 'utf8')).toBe('complete previous report');
  expect(readFileSync('source.js', 'utf8')).toBe(original);
  expect(readdirSync('.').sort()).toEqual(['report', 'source.js']);
});

it('preserves another writer\'s report after a noticed edit', () => {
  writeFileSync('report', 'old report');
  const write = prepareReportOutput('report', ['source.js']);
  writeFileSync('report', 'another writer changed this report');
  expect(() => write('new report')).toThrow('destination changed');
  expect(readFileSync('report', 'utf8')).toBe('another writer changed this report');
});

it('rechecks input identities when a hard link appears after preparation', () => {
  const write = prepareReportOutput('report', ['source.js']);
  linkSync('source.js', 'report');
  expect(() => write('new report')).toThrow('overlaps an input');
  expect(readFileSync('source.js', 'utf8')).toBe(original);
});

it.skipIf(process.platform === 'win32')('does not create a report at a missing input through a parent link', () => {
  mkdirSync('real'); symlinkSync('real', 'alias', 'dir');
  const result = run(['alias/missing.js', '--output', 'real/missing.js']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('overlaps an input');
  expect(readdirSync('real')).toEqual([]);
});

it.skipIf(process.platform === 'win32')('refuses a retargeted parent directory link', () => {
  mkdirSync('first'); mkdirSync('second'); symlinkSync('first', 'alias', 'dir');
  const write = prepareReportOutput('alias/report', ['source.js']);
  rmSync('alias'); symlinkSync('second', 'alias', 'dir');
  expect(() => write('new report')).toThrow('parent directory changed');
  expect(readdirSync('first')).toEqual([]);
  expect(readdirSync('second')).toEqual([]);
});

it.each([{ args: ['--output'] }, { args: ['--output='] }, { args: ['reveal', 'source.js', '--output', 'report'] }])('rejects invalid output usage $args without writing', ({ args }) => {
  expect(run(args).code).toBe(2);
  expect(readdirSync('.')).toEqual(['source.js']);
});

import { chmodSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type * as Fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceFiles, type RepairPlan } from '../src/cli/replaceFiles.js';

// Real files and partial writes; only the failure point is injected. These
// checks concern original bytes, permissions and cleanup, not call sequences.
const faults = vi.hoisted(() => ({
  writeFailureAt: 0, writes: 0, syncFailure: false,
  renameFailureAt: 0, renames: 0, editDuringWrite: '',
  swapTemporary: false,
}));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof Fs>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (typeof args[0] === 'number' && Buffer.isBuffer(args[1])) {
        if (++faults.writes === faults.writeFailureAt) {
          fs.writeSync(args[0], args[1].subarray(0, 4));
          throw Object.assign(new Error('ENOSPC: simulated failure after a partial write'), { code: 'ENOSPC' });
        }
        if (faults.editDuringWrite) {
          fs.writeFileSync(faults.editDuringWrite, 'an external editor changed this file');
          faults.editDuringWrite = '';
        }
      }
      return fs.writeFileSync(...args);
    },
    fsyncSync: (...args: Parameters<typeof fs.fsyncSync>) => {
      if (faults.syncFailure) throw Object.assign(new Error('EIO: simulated flush failure'), { code: 'EIO' });
      return fs.fsyncSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (faults.swapTemporary) {
        fs.renameSync(args[0], `${String(args[0])}.moved`);
        fs.writeFileSync(args[0], 'another file now occupies the temporary path');
        throw new Error('replacement failed after another writer moved the temporary file');
      }
      if (++faults.renames === faults.renameFailureAt) {
        throw Object.assign(new Error('EACCES: simulated replacement failure'), { code: 'EACCES' });
      }
      return fs.renameSync(...args);
    },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ghostchars-replace-'));
  Object.assign(faults, { writeFailureAt: 0, writes: 0, syncFailure: false, renameFailureAt: 0, renames: 0, editDuringWrite: '', swapTemporary: false });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function plan(name: string): RepairPlan {
  const original = Buffer.from('keep the whole original a\u200bb\n');
  const replacement = Buffer.from('keep the whole original ab\n');
  const absPath = join(root, name);
  writeFileSync(absPath, original);
  return { path: name, absPath, original, replacement };
}

function onlyOriginalNames(...names: string[]): void {
  expect(readdirSync(root).sort()).toEqual(names.sort());
}

it.each([1, 2])('partial failure staging file %i preserves every original', writeFailureAt => {
  const plans = [plan('a.txt'), plan('b.txt')];
  faults.writeFailureAt = writeFailureAt;
  const result = replaceFiles(plans);
  expect(result.repaired).toBe(0);
  expect(result.errors[0]!.reason).toContain('ENOSPC');
  for (const p of plans) expect(readFileSync(p.absPath)).toEqual(p.original);
  onlyOriginalNames('a.txt', 'b.txt');
});

it('a flush failure cannot publish an unflushed replacement', () => {
  const p = plan('source.txt');
  faults.syncFailure = true;
  const result = replaceFiles([p]);
  expect(result.repaired).toBe(0);
  expect(result.errors[0]!.reason).toContain('EIO');
  expect(readFileSync(p.absPath)).toEqual(p.original);
  onlyOriginalNames('source.txt');
});

it.each([1, 2])('replacement failure at file %i leaves that original and all later files intact', renameFailureAt => {
  const plans = [plan('a.txt'), plan('b.txt'), plan('c.txt')];
  faults.renameFailureAt = renameFailureAt;
  const result = replaceFiles(plans);
  expect(result.repaired).toBe(renameFailureAt - 1);
  expect(result.errors[0]!.reason).toContain('EACCES');
  plans.forEach((p, i) => expect(readFileSync(p.absPath)).toEqual(i < result.repaired ? p.replacement : p.original));
  onlyOriginalNames('a.txt', 'b.txt', 'c.txt');
});

it('a noticed edit while staging cancels the whole batch without overwriting the edit', () => {
  const plans = [plan('a.txt'), plan('b.txt')];
  faults.editDuringWrite = plans[0]!.absPath;
  const result = replaceFiles(plans);
  expect(result.repaired).toBe(0);
  expect(result.errors[0]!.reason).toContain('changed');
  expect(readFileSync(plans[0]!.absPath, 'utf8')).toBe('an external editor changed this file');
  expect(readFileSync(plans[1]!.absPath)).toEqual(plans[1]!.original);
  onlyOriginalNames('a.txt', 'b.txt');
});

it('cleanup leaves a different file occupying the temporary path untouched', () => {
  const p = plan('source.txt');
  faults.swapTemporary = true;
  const result = replaceFiles([p]);
  expect(result.repaired).toBe(0);
  expect(result.errors.some(error => error.reason.includes('different file'))).toBe(true);
  expect(readFileSync(p.absPath)).toEqual(p.original);
  const temporary = readdirSync(root).find(name => name.endsWith('.tmp'))!;
  expect(readFileSync(join(root, temporary), 'utf8')).toBe('another file now occupies the temporary path');
});

it('does not sever hard links or mutate their other names', () => {
  const plans = [plan('a.txt'), plan('b.txt')];
  linkSync(plans[1]!.absPath, join(root, 'alias.txt'));
  const result = replaceFiles(plans);
  expect(result.repaired).toBe(0);
  expect(result.errors[0]!.reason).toContain('hard-linked');
  for (const p of plans) expect(readFileSync(p.absPath)).toEqual(p.original);
  expect(readFileSync(join(root, 'alias.txt'))).toEqual(plans[1]!.original);
  expect(statSync(plans[1]!.absPath).nlink).toBe(2);
  onlyOriginalNames('a.txt', 'b.txt', 'alias.txt');
});

describe.skipIf(process.platform === 'win32')('POSIX metadata', () => {
  it('preserves executable/private mode and owner even under a restrictive umask', () => {
    const p = plan('script.sh');
    chmodSync(p.absPath, 0o751);
    const before = statSync(p.absPath);
    const previous = process.umask(0o077);
    try { expect(replaceFiles([p])).toEqual({ repaired: 1, errors: [] }); }
    finally { process.umask(previous); }
    const after = statSync(p.absPath);
    expect(after.mode & 0o7777).toBe(0o751);
    expect([after.uid, after.gid]).toEqual([before.uid, before.gid]);
    expect(readFileSync(p.absPath)).toEqual(p.replacement);
    onlyOriginalNames('script.sh');
  });

  it.skipIf(process.getuid?.() === 0)('cannot bypass a read-only original through its writable directory', () => {
    const p = plan('readonly.txt');
    chmodSync(p.absPath, 0o444);
    try {
      const result = replaceFiles([p]);
      expect(result.repaired).toBe(0);
      expect(result.errors[0]!.reason).toContain('EACCES');
      expect(readFileSync(p.absPath)).toEqual(p.original);
      onlyOriginalNames('readonly.txt');
    } finally { chmodSync(p.absPath, 0o600); }
  });
});

import {
  closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { throughSymlink } from './walk.js';

export interface RepairPlan {
  path: string;
  absPath: string;
  original: Buffer;
  replacement: Buffer;
}

interface StagedRepair {
  plan: RepairPlan;
  originalStat: BigIntStats;
  temporary: string;
  temporaryStat: BigIntStats;
}

interface RepairError { path: string; reason: string }

// atime can change merely because we read a file. Compare identity, contents'
// timestamps and permissions instead, including sub-millisecond edit times.
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid', 'nlink'] as const)
    .every(key => a[key] === b[key]);
}

function removeTemporary(path: string, owned: BigIntStats): void {
  try {
    const current = lstatSync(path, { bigint: true });
    if (current.dev !== owned.dev || current.ino !== owned.ino || !current.isFile()) {
      throw new Error('temporary path now belongs to a different file; left it untouched');
    }
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function inspectOriginal(plan: RepairPlan, expected?: BigIntStats): BigIntStats {
  if (throughSymlink(plan.absPath)) throw new Error('path became a symbolic link after scanning');
  const named = lstatSync(plan.absPath, { bigint: true });
  if (!named.isFile()) throw new Error('path is no longer a regular file');
  // r+ checks actual write access without truncating. Replacing by rename must
  // not silently bypass a read-only original just because its directory is writable.
  const fd = openSync(plan.absPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!sameFile(named, before) || (expected && !sameFile(expected, before))) {
      throw new Error('file or its metadata changed after scanning; scan it again before repairing');
    }
    if (before.nlink !== 1n) {
      throw new Error('hard-linked files cannot be replaced safely; make an independent copy before repairing');
    }
    if (!readFileSync(fd).equals(plan.original) || !sameFile(before, fstatSync(fd, { bigint: true }))) {
      throw new Error('file changed after scanning; scan it again before repairing');
    }
    return before;
  } finally { closeSync(fd); }
}

function stage(plan: RepairPlan): StagedRepair {
  const originalStat = inspectOriginal(plan);
  const temporary = join(dirname(plan.absPath), `.ghostchars-${randomUUID()}.tmp`);
  let fd: number | undefined;
  let created: BigIntStats | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    created = fstatSync(fd, { bigint: true });
    writeFileSync(fd, plan.replacement);
    // Preserve ownership where POSIX exposes it. Failure must leave the original
    // alone, not turn a file belonging to another user into one belonging to us.
    if (process.platform !== 'win32') {
      const current = fstatSync(fd, { bigint: true });
      if (current.uid !== originalStat.uid || current.gid !== originalStat.gid) {
        fchownSync(fd, Number(originalStat.uid), Number(originalStat.gid));
      }
    }
    fchmodSync(fd, Number(originalStat.mode & 0o7777n));
    if (process.platform !== 'win32') {
      const prepared = fstatSync(fd, { bigint: true });
      if (prepared.uid !== originalStat.uid || prepared.gid !== originalStat.gid
        || (prepared.mode & 0o7777n) !== (originalStat.mode & 0o7777n)) {
        throw new Error('replacement could not retain the original owner and permissions');
      }
    }
    fsyncSync(fd);
    const closing = fd; fd = undefined;
    closeSync(closing);
    return { plan, originalStat, temporary, temporaryStat: lstatSync(temporary, { bigint: true }) };
  } catch (error) {
    const failures = [message(error)];
    if (fd !== undefined) {
      try { closeSync(fd); } catch (closeError) { failures.push(`closing replacement: ${message(closeError)}`); }
    }
    if (created) {
      try { removeTemporary(temporary, created); }
      catch (cleanupError) { failures.push(`removing ${temporary}: ${message(cleanupError)}`); }
    }
    throw new Error(failures.join('; '));
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Prepare every replacement before changing any original. Each rename is one
 * filesystem operation, not a transaction across the batch or a compare-and-swap
 * against concurrent editors. An interrupted staging write can leave a temporary
 * file, but never a partially overwritten original.
 */
export function replaceFiles(plans: RepairPlan[]): { repaired: number; errors: RepairError[] } {
  const staged: StagedRepair[] = [];
  const errors: RepairError[] = [];
  let repaired = 0;
  try {
    for (const plan of plans) {
      try { staged.push(stage(plan)); }
      catch (error) {
        errors.push({ path: plan.path, reason: `could not prepare repair: ${message(error)}` });
        return { repaired, errors };
      }
    }
    // A later input can change while earlier ones are staged. Check the whole
    // batch before the first replacement so a noticed edit cancels all repairs.
    for (const entry of staged) {
      try { inspectOriginal(entry.plan, entry.originalStat); }
      catch (error) {
        errors.push({ path: entry.plan.path, reason: `could not repair file: ${message(error)}` });
        return { repaired, errors };
      }
    }
    for (const entry of staged) {
      try {
        if (throughSymlink(entry.plan.absPath)
          || !sameFile(entry.originalStat, lstatSync(entry.plan.absPath, { bigint: true }))) {
          throw new Error('file or its metadata changed before replacement; scan it again before repairing');
        }
        if (!sameFile(entry.temporaryStat, lstatSync(entry.temporary, { bigint: true }))
          || !readFileSync(entry.temporary).equals(entry.plan.replacement)) {
          throw new Error('temporary replacement changed; original left untouched');
        }
        renameSync(entry.temporary, entry.plan.absPath);
        repaired++;
      } catch (error) {
        errors.push({ path: entry.plan.path, reason: `could not replace file: ${message(error)}` });
        break;
      }
    }
  } finally {
    // Do not remove another inode if a temporary pathname was visibly replaced.
    for (const entry of staged.slice(repaired)) {
      try { removeTemporary(entry.temporary, entry.temporaryStat); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push({ path: entry.plan.path, reason: `could not remove temporary repair ${entry.temporary}: ${message(error)}` });
        }
      }
    }
  }
  return { repaired, errors };
}

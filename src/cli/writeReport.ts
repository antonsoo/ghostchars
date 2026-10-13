import { randomUUID } from 'node:crypto';
import {
  accessSync, closeSync, constants, fstatSync, fsyncSync, lstatSync,
  openSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

interface Identity { path: string; stat?: BigIntStats }

function absent(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
}

function inputIdentity(path: string): Identity {
  try { return { path: realpathSync(path), stat: statSync(path, { bigint: true }) }; }
  catch (error) {
    if (!absent(error)) throw error;
    try { return { path: join(realpathSync(dirname(path)), basename(path)) }; }
    catch (parentError) { if (!absent(parentError)) throw parentError; }
    return { path: resolve(path) };
  }
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function sameDestination(a?: BigIntStats, b?: BigIntStats): boolean {
  if (!a || !b) return a === b;
  return (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid', 'nlink'] as const)
    .every(key => a[key] === b[key]);
}

/** Validate before scanning/repairing, then stage only after the report is ready.
 * Input identities are retained and checked again so both original aliases and
 * current source paths remain protected after a repair replaces an inode. */
export function prepareReportOutput(output: string, inputs: readonly string[]): (text: string) => void {
  const destination = resolve(output);
  const canonical = join(realpathSync(dirname(destination)), basename(destination));
  const inputPaths = [...new Set(inputs.map(path => resolve(path)))];
  const originals = inputPaths.map(inputIdentity);
  const inspect = (refreshInputs = true): BigIntStats | undefined => {
    if (join(realpathSync(dirname(destination)), basename(destination)) !== canonical) {
      throw new Error('report parent directory changed; choose a stable output path');
    }
    let info: BigIntStats | undefined;
    try { info = lstatSync(destination, { bigint: true }); }
    catch (error) { if (!absent(error)) throw error; }
    if (info && !info.isFile()) throw new Error('report output must be a regular file, not a symbolic link or special file');
    for (const input of refreshInputs ? [...originals, ...inputPaths.map(inputIdentity)] : originals) {
      if (input.path === canonical || (info && input.stat && sameIdentity(info, input.stat))) {
        throw new Error('report output overlaps an input or configuration file; choose a separate path outside the scan or ignore the report');
      }
    }
    if (info) accessSync(destination, constants.W_OK);
    return info;
  };
  const expected = inspect(false);

  return (text: string): void => {
    if (!sameDestination(expected, inspect())) throw new Error('report destination changed since scanning; previous output left untouched');
    const temporary = join(dirname(destination), `.ghostchars-report-${randomUUID()}.tmp`);
    let owned: BigIntStats | undefined;
    const failures: unknown[] = [];
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        owned = fstatSync(fd, { bigint: true });
        writeFileSync(fd, text, 'utf8');
        fsyncSync(fd);
      } finally { closeSync(fd); }
      if (!sameDestination(expected, inspect())) throw new Error('report destination changed while writing; previous output left untouched');
      const staged = lstatSync(temporary, { bigint: true });
      if (!staged.isFile() || !sameIdentity(staged, owned)) throw new Error('temporary report path changed; output left untouched');
      renameSync(temporary, destination);
    } catch (error) {
      failures.push(error);
    } finally {
      if (owned) {
        try {
          const current = lstatSync(temporary, { bigint: true });
          if (current.isFile() && sameIdentity(current, owned)) unlinkSync(temporary);
        } catch (error) { if (!absent(error)) failures.push(error); }
      }
    }
    if (failures.length) throw new Error(failures.map(error => error instanceof Error ? error.message : String(error)).join('; '));
  };
}

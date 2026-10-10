import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { fileEncoding } from './encoding.js';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB: past this, "scan a file" stops being interactive-CLI-fast.

export interface DiscoveredFile {
  /** Path relative to the CWD, using forward slashes, for stable output/config matching. */
  path: string;
  absPath: string;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; reason: string }>;
}

/** Includes symlinked parent directories, e.g. a tracked directory replaced by a link. */
export function throughSymlink(path: string): boolean {
  // Inspect link metadata rather than comparing realpath spelling: case-folding
  // filesystems can canonicalize the spelling of an ordinary, non-link path.
  for (let current = path; ; current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) return true;
    if (dirname(current) === current) return false;
  }
}

/**
 * Resolves `inputPaths` (defaulting to ".") to a flat list of files to scan.
 * Inside a git repository, uses `git ls-files` (tracked + untracked-but-not-
 * ignored) so the tool naturally respects .gitignore and never descends into
 * node_modules/.git. Outside a repo, walks the tree by hand with minimal
 * .gitignore-style filtering. Either way, binaries and oversized files are
 * skipped (reported, not silently dropped).
 */
export function discoverFiles(inputPaths: string[], cwd: string = process.cwd()): DiscoveryResult {
  const targets = inputPaths.length ? inputPaths : ['.'];
  const result: DiscoveryResult = { files: [], skipped: [], errors: [] };
  const seen = new Set<string>();
  let base: string;
  try { base = realpathSync(cwd); }
  catch (error) {
    result.errors.push({ path: cwd, reason: `could not resolve working directory: ${(error as Error).message}` });
    return result;
  }
  const fail = (abs: string, operation: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    result.errors.push({ path: toPosix(relative(base, abs) || '.'), reason: `${operation}: ${reason}` });
  };

  for (const target of targets) {
    const absTarget = resolve(base, target);
    let stat;
    try {
      stat = lstatSync(absTarget);
      if (throughSymlink(absTarget)) {
        result.errors.push({ path: target, reason: 'symbolic links are not scanned or repaired; pass the target\'s real path explicitly' });
        continue;
      }
    } catch (error) {
      fail(absTarget, 'could not inspect path', error);
      continue;
    }

    if (stat.isFile()) {
      addFile(absTarget, base, result, seen, fail);
      continue;
    }
    if (!stat.isDirectory()) {
      result.errors.push({ path: target, reason: 'not a regular file or directory' });
      continue;
    }

    const repoRoot = findGitRoot(absTarget);
    const candidates = repoRoot ? listGitFiles(repoRoot, absTarget, fail) : listWalk(absTarget, fail);
    for (const abs of candidates) addFile(abs, base, result, seen, fail);
  }

  result.files.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

type DiscoveryFailure = (path: string, operation: string, error: unknown) => void;

function addFile(absPath: string, cwd: string, result: DiscoveryResult, seen: Set<string>, fail: DiscoveryFailure) {
  if (seen.has(absPath)) return;
  seen.add(absPath);
  const path = toPosix(relative(cwd, absPath) || absPath);

  let stat;
  try {
    stat = lstatSync(absPath);
    if (throughSymlink(absPath)) {
      result.skipped.push({ path, reason: 'symbolic link (not followed)' });
      return;
    }
  } catch (error) {
    fail(absPath, 'could not inspect path', error);
    return;
  }
  if (!stat.isFile()) {
    result.skipped.push({ path, reason: 'not a regular file' });
    return;
  }
  if (stat.size > MAX_FILE_BYTES) {
    result.skipped.push({ path, reason: `too large (${(stat.size / (1024 * 1024)).toFixed(1)} MiB > ${MAX_FILE_BYTES / (1024 * 1024)} MiB)` });
    return;
  }
  try {
    if (isLikelyBinary(absPath)) {
      result.skipped.push({ path, reason: 'binary' });
      return;
    }
  } catch (error) {
    fail(absPath, 'could not read file', error);
    return;
  }
  result.files.push({ path, absPath });
}

function isLikelyBinary(absPath: string): boolean {
  const buf = readFileSync(absPath);
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (fileEncoding(sample) !== 'utf-8') {
    // UTF-16 text is half zero bytes; judge the characters, not the bytes.
    // Sampling can end inside a surrogate pair. Full, strict decoding happens
    // in the scan, so discovery must not label a cut sample as a binary file.
    const text = new TextDecoder(fileEncoding(sample)).decode(sample, { stream: true });
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001a\u001c-\u001f]/.test(text);
  }
  if (sample.includes(0)) return true;
  // A high proportion of non-text bytes (outside common control chars) also indicates binary.
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.3;
}

function findGitRoot(startAbs: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', startAbs, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function listGitFiles(repoRoot: string, scopeAbs: string, fail: DiscoveryFailure): string[] {
  const scopeRel = relative(repoRoot, scopeAbs);
  const args = ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', scopeRel === '' ? '.' : scopeRel];
  try {
    const out = execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();
    return out
      .split('\0')
      .filter(Boolean)
      .map((p) => join(repoRoot, p));
  } catch (error) {
    fail(scopeAbs, 'could not enumerate git files', error);
    return [];
  }
}

const ALWAYS_IGNORE_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', '.venv', '__pycache__']);

function listWalk(rootAbs: string, fail: DiscoveryFailure): string[] {
  const out: string[] = [];
  const gitignore = loadGitignorePatterns(rootAbs, fail);

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      fail(dir, 'could not list directory', error);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && ALWAYS_IGNORE_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(rootAbs, abs));
      if (isGitignored(rel, gitignore)) continue;
      if (entry.isDirectory()) walk(abs);
      else out.push(abs); // addFile records symlinks and other deliberate exclusions
    }
  };
  walk(rootAbs);
  return out;
}

interface IgnoreRule {
  regex: RegExp;
  negate: boolean;
}

function loadGitignorePatterns(rootAbs: string, fail: DiscoveryFailure): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  try {
    const path = join(rootAbs, '.gitignore');
    if (lstatSync(path).isSymbolicLink()) throw new Error('symbolic-link ignore policies are not followed');
    const text = readFileSync(path, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      const pattern = negate ? line.slice(1) : line;
      rules.push({ regex: globToRegex(pattern), negate });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail(join(rootAbs, '.gitignore'), 'could not read ignore policy', error);
  }
  return rules;
}

function isGitignored(relPath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) ignored = !rule.negate;
  }
  return ignored;
}

/** Minimal .gitignore-pattern -> RegExp, supporting `*`, `**`, `?`, and leading/trailing `/`. */
export function globToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  const matchesDir = p.endsWith('/');
  if (matchesDir) p = p.slice(0, -1);

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c!)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  const prefix = anchored ? '^' : '(^|.*/)';
  const suffix = matchesDir ? '(/.*)?$' : '(/.*)?$';
  return new RegExp(`${prefix}${re}${suffix}`);
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

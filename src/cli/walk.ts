import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB: past this, "scan a file" stops being interactive-CLI-fast.

export interface DiscoveredFile {
  /** Path relative to the CWD, using forward slashes, for stable output/config matching. */
  path: string;
  absPath: string;
}

/**
 * Resolves `inputPaths` (defaulting to ".") to a flat list of files to scan.
 * Inside a git repository, uses `git ls-files` (tracked + untracked-but-not-
 * ignored) so the tool naturally respects .gitignore and never descends into
 * node_modules/.git. Outside a repo, walks the tree by hand with minimal
 * .gitignore-style filtering. Either way, binaries and oversized files are
 * skipped (reported, not silently dropped).
 */
export function discoverFiles(inputPaths: string[], cwd: string = process.cwd()): { files: DiscoveredFile[]; skipped: Array<{ path: string; reason: string }> } {
  const targets = inputPaths.length ? inputPaths : ['.'];
  const skipped: Array<{ path: string; reason: string }> = [];
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const absTarget = resolve(cwd, target);
    let stat;
    try {
      stat = statSync(absTarget);
    } catch {
      skipped.push({ path: target, reason: 'not found' });
      continue;
    }

    if (stat.isFile()) {
      addFile(absTarget, cwd, files, skipped, seen);
      continue;
    }

    const repoRoot = findGitRoot(absTarget);
    const candidates = repoRoot ? listGitFiles(repoRoot, absTarget) : listWalk(absTarget);
    for (const abs of candidates) addFile(abs, cwd, files, skipped, seen);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

function addFile(absPath: string, cwd: string, files: DiscoveredFile[], skipped: Array<{ path: string; reason: string }>, seen: Set<string>) {
  if (seen.has(absPath)) return;
  seen.add(absPath);
  const path = toPosix(relative(cwd, absPath) || absPath);

  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    skipped.push({ path, reason: 'not found' });
    return;
  }
  if (!stat.isFile()) return;
  if (stat.size > MAX_FILE_BYTES) {
    skipped.push({ path, reason: `too large (${(stat.size / (1024 * 1024)).toFixed(1)} MiB > ${MAX_FILE_BYTES / (1024 * 1024)} MiB)` });
    return;
  }
  if (isLikelyBinary(absPath)) {
    skipped.push({ path, reason: 'binary' });
    return;
  }
  files.push({ path, absPath });
}

function isLikelyBinary(absPath: string): boolean {
  try {
    const buf = readFileSync(absPath);
    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    if (sample.includes(0)) return true;
    // A high proportion of non-text bytes (outside common control chars) also indicates binary.
    let suspicious = 0;
    for (const byte of sample) {
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) suspicious++;
    }
    return sample.length > 0 && suspicious / sample.length > 0.3;
  } catch {
    return true;
  }
}

function findGitRoot(startAbs: string): string | undefined {
  try {
    const out = execFileSync('git', ['-C', startAbs, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function listGitFiles(repoRoot: string, scopeAbs: string): string[] {
  const scopeRel = relative(repoRoot, scopeAbs);
  const args = ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', scopeRel === '' ? '.' : scopeRel];
  try {
    const out = execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out
      .split('\0')
      .filter(Boolean)
      .map((p) => join(repoRoot, p));
  } catch {
    return listWalk(scopeAbs);
  }
}

const ALWAYS_IGNORE_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', '.venv', '__pycache__']);

function listWalk(rootAbs: string): string[] {
  const out: string[] = [];
  const gitignore = loadGitignorePatterns(rootAbs);

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && ALWAYS_IGNORE_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(rootAbs, abs));
      if (isGitignored(rel, gitignore)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  };
  const stat = statSync(rootAbs);
  if (stat.isFile()) return [rootAbs];
  walk(rootAbs);
  return out;
}

interface IgnoreRule {
  regex: RegExp;
  negate: boolean;
}

function loadGitignorePatterns(rootAbs: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  try {
    const text = readFileSync(join(rootAbs, '.gitignore'), 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      const pattern = negate ? line.slice(1) : line;
      rules.push({ regex: globToRegex(pattern), negate });
    }
  } catch {
    // no .gitignore; fine
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

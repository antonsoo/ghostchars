import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuleId, ScanOptions, Severity } from '../core/index.js';
import { globToRegex } from './walk.js';

type RuleOverrides = Partial<Record<RuleId, Severity | false>>;

interface FileOverride {
  files: string[];
  rules?: RuleOverrides;
  allow?: Array<number | string>;
}

export interface GhostcharsConfig {
  rules?: RuleOverrides;
  allow?: Array<number | string>;
  overrides?: FileOverride[];
}

const CONFIG_FILENAME = '.ghostcharsrc.json';

export function loadConfig(cwd: string, explicitPath?: string): GhostcharsConfig {
  const path = explicitPath ?? join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw as GhostcharsConfig;
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

function parseAllow(entries: Array<number | string> | undefined): number[] {
  if (!entries) return [];
  return entries.map((e) => {
    if (typeof e === 'number') return e;
    const m = /^U\+([0-9a-fA-F]+)$/.exec(e.trim());
    if (m) return parseInt(m[1]!, 16);
    const n = Number(e);
    if (!Number.isNaN(n)) return n;
    throw new Error(`Invalid code point in config allowlist: ${e}`);
  });
}

/** Resolves the ScanOptions for one file, merging global config with the first matching override block. */
export function scanOptionsForFile(config: GhostcharsConfig, filePath: string): ScanOptions {
  const severityOverrides: RuleOverrides = { ...config.rules };
  const allow = new Set(parseAllow(config.allow));

  for (const override of config.overrides ?? []) {
    if (override.files.some((glob) => globToRegex(glob).test(filePath))) {
      Object.assign(severityOverrides, override.rules);
      for (const cp of parseAllow(override.allow)) allow.add(cp);
    }
  }

  return { file: filePath, severityOverrides, allowCodePoints: allow };
}

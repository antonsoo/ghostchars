import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuleId, ScanOptions, Severity } from '../core/index.js';
import { globToRegex } from './walk.js';

type RuleOverrides = Partial<Record<RuleId, Severity | false>>;

interface FileOverride {
  files: string[];
  rules?: RuleOverrides;
  allow?: Array<number | string>;
  isCode?: boolean;
}

export interface GhostcharsConfig {
  rules?: RuleOverrides;
  allow?: Array<number | string>;
  isCode?: boolean;
  overrides?: FileOverride[];
}

const CONFIG_FILENAME = '.ghostcharsrc.json';
const RULES = new Set<RuleId>(['bidi-control', 'bidi-mark', 'bidi-unbalanced', 'tag-smuggling', 'variation-selector-smuggling', 'variation-selector-stray', 'invisible', 'confusable', 'styled-text', 'unusual-whitespace', 'control-character']);

export function loadConfig(cwd: string, explicitPath?: string): GhostcharsConfig {
  const path = explicitPath ?? join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) {
    if (explicitPath !== undefined) throw new Error(`Config file does not exist: ${path}`);
    return {};
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    validateConfig(raw);
    return raw as GhostcharsConfig;
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function validateBlock(value: unknown, label: string, override: boolean): Record<string, unknown> {
  const block = object(value, label);
  const keys = override ? ['files', 'rules', 'allow', 'isCode'] : ['rules', 'allow', 'overrides', 'isCode'];
  for (const key of Object.keys(block)) if (!keys.includes(key)) throw new Error(`Unknown ${label} option: ${key}`);
  if (block.isCode !== undefined && typeof block.isCode !== 'boolean') throw new Error(`${label}.isCode must be a boolean`);
  if (block.rules !== undefined) {
    for (const [rule, severity] of Object.entries(object(block.rules, `${label}.rules`))) {
      if (!RULES.has(rule as RuleId)) throw new Error(`Unknown rule in ${label}: ${rule}`);
      if (severity !== false && severity !== 'info' && severity !== 'warning' && severity !== 'error') throw new Error(`Rule ${rule} must use false, "info", "warning", or "error"`);
    }
  }
  if (block.allow !== undefined) {
    if (!Array.isArray(block.allow) || block.allow.some((entry) => typeof entry !== 'number' && typeof entry !== 'string')) throw new Error(`${label}.allow must be an array of code points`);
    parseAllow(block.allow as Array<number | string>);
  }
  if (override && (!Array.isArray(block.files) || !block.files.length || block.files.some((entry) => typeof entry !== 'string' || !entry.trim()))) throw new Error(`${label}.files must be a nonempty array of glob strings`);
  return block;
}

function validateConfig(value: unknown): void {
  const config = validateBlock(value, 'config', false);
  if (config.overrides !== undefined) {
    if (!Array.isArray(config.overrides)) throw new Error('config.overrides must be an array');
    config.overrides.forEach((entry, index) => validateBlock(entry, `overrides[${index}]`, true));
  }
}

function parseAllow(entries: Array<number | string> | undefined): number[] {
  if (!entries) return [];
  return entries.map((e) => {
    const m = typeof e === 'string' ? /^U\+([0-9a-fA-F]+)$/.exec(e.trim()) : null;
    const n = m ? parseInt(m[1]!, 16) : typeof e === 'string' && !e.trim() ? NaN : Number(e);
    if (Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return n;
    throw new Error(`Invalid code point in config allowlist: ${e}`);
  });
}

/** Resolves global config and all matching override blocks, in file order. */
export function scanOptionsForFile(config: GhostcharsConfig, filePath: string): ScanOptions {
  const severityOverrides: RuleOverrides = { ...config.rules };
  const allow = new Set(parseAllow(config.allow));
  let isCode = config.isCode;

  for (const override of config.overrides ?? []) {
    if (override.files.some((glob) => globToRegex(glob).test(filePath))) {
      Object.assign(severityOverrides, override.rules);
      for (const cp of parseAllow(override.allow)) allow.add(cp);
      if (override.isCode !== undefined) isCode = override.isCode;
    }
  }

  return { file: filePath, severityOverrides, allowCodePoints: allow, ...(isCode === undefined ? {} : { isCode }) };
}

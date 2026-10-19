import { parse } from 'acorn';
import { scanText, finishScan } from './scanText.js';
import { scanIdentifierConfusables } from './rules/confusables.js';
import type { IdentifierToken } from './rules/confusables.js';
import { positionIndex } from './rules/position.js';
import type { ScanOptions, ScanResult } from './types.js';

export type JavaScriptSourceType = 'module' | 'script' | 'commonjs';
export interface JavaScriptScanOptions extends Omit<ScanOptions, 'isCode'> {
  /** The grammar to parse. No syntax fallback is attempted. Default: module. */
  sourceType?: JavaScriptSourceType;
}

/** Parse JavaScript without executing it. Invalid/unsupported syntax throws.
 * Confusable comparisons use identifier names, including Unicode escapes;
 * other rules still inspect the original text. Names are compared file-wide,
 * without resolving scopes, declarations or property access at runtime. */
export function scanJavaScript(text: string, options: JavaScriptScanOptions = {}): ScanResult {
  const names = new Map<number, IdentifierToken>();
  const escapedNames = new Map<number, string>();
  const sourceType = options.sourceType ?? 'module';
  if (!['module', 'script', 'commonjs'].includes(sourceType)) {
    throw new TypeError('JavaScript sourceType must be module, script or commonjs');
  }
  const tree = parse(text, {
    ecmaVersion: 2026,
    sourceType,
  });
  // Walk AST identifiers, not lexical name tokens: a keyword in box.default
  // is an IdentifierName too. Shorthand keys and import/export names can have
  // two AST nodes for one source occurrence; retain that occurrence only once.
  const pending: unknown[] = [tree];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    const node = value as Record<string, unknown>;
    if (typeof node.type !== 'string') continue;
    if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') {
      if (typeof node.name !== 'string' || typeof node.start !== 'number' || typeof node.end !== 'number') {
        throw new Error('JavaScript parser did not supply an identifier name and range');
      }
      const name = (node.type === 'PrivateIdentifier' ? '#' : '') + node.name;
      names.set(node.start, { text: name, index: node.start, end: node.end });
      if (text.slice(node.start, node.end).includes('\\')) escapedNames.set(node.start, name);
    } else {
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) {
          for (const item of child) pending.push(item);
        } else if (child !== null && typeof child === 'object') pending.push(child);
      }
    }
  }
  const positionAt = positionIndex(text);
  const parsed = scanIdentifierConfusables([...names.values()], positionAt);
  for (const finding of parsed) {
    const raw = text.slice(finding.start.offset, finding.end.offset);
    // The parser supplies the name, never a replacement to write into source.
    const name = escapedNames.get(finding.start.offset);
    if (name !== undefined) {
      finding.decoded = name;
    }
    const display = name === undefined ? `JavaScript name ${JSON.stringify(raw)}`
      : `Source ${JSON.stringify(raw)} decodes to JavaScript name ${JSON.stringify(name)}`;
    finding.message = finding.severity === 'error'
      ? `${display}; a different name in this file shares its skeleton ${JSON.stringify(finding.skeleton)}.`
      : `${display} has a mixed-script shape; skeleton ${JSON.stringify(finding.skeleton)}.`;
    finding.suggestion = 'Check the names in their scopes before renaming; this scan does not resolve bindings.';
  }
  // Apply policy once to the combined observations. In particular, an allowed
  // code-point iterable may be a generator that cannot be consumed twice.
  const ordinary = scanText(text, { severityOverrides: { confusable: false } });
  return finishScan(text, [...ordinary.findings, ...parsed], options);
}

// Single-run synthetic normalization timings, with exact-output checks.
import os from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { lib: { type: 'string' } } });
if (!values.lib) throw new Error('Use --lib PATH to the built or installed library');
const { sanitize } = await import(pathToFileURL(resolve(values.lib)).href);
const rows = [];
for (const count of [3000, 30000, 100000]) {
  const text = 'alpha\u00a0beta '.repeat(count), expected = 'alpha beta '.repeat(count);
  const start = performance.now();
  const result = sanitize(text, { mode: 'normalize' });
  const elapsed = performance.now() - start;
  if (result.text !== expected || result.fixed.length !== count || result.remaining.length) throw new Error('Normalization mismatch');
  rows.push({ flaggedSpaces: count, inputBytes: Buffer.byteLength(text), elapsedMilliseconds: elapsed, exactOutputMatched: true, fixed: result.fixed.length, remaining: result.remaining.length });
}
console.log(JSON.stringify({ population: 'Synthetic repeated word pairs. Single runs, not a general complexity or performance guarantee.', node: process.version, platform: process.platform, cpus: os.cpus().length, totalMemoryBytes: os.totalmem(), rows }, null, 2));

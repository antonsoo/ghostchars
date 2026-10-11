// node studies/bidi-scaling/benchmark.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw new Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const libraries = {};
for (const [name, root] of [['before', beforeRoot], ['after', afterRoot]]) {
  libraries[name] = await import(pathToFileURL(resolve(root, 'dist/index.js')));
}
const sha = value => createHash('sha256').update(value).digest('hex');
const cases = [];
for (const n of [4_000, 16_000, 32_000, 48_000]) cases.push({ name: 'unmatched', n, text: '\u202e'.repeat(n) + '\u2069'.repeat(n) });
cases.push({ name: 'nested', n: 32_000, text: '\u2066'.repeat(32_000) + '\u2069'.repeat(32_000) });
for (const library of Object.values(libraries)) for (let i = 0; i < 2; i++) library.scanText('\u202e'.repeat(1000) + '\u2069'.repeat(1000));
const results = [];
for (const { name, n, text } of cases) {
  const runsMs = { before: [], after: [] };
  let digest, findings;
  for (let run = 0; run < 3; run++) {
    // Alternate order to avoid always giving the same version the second slot.
    for (const version of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now();
      const scan = libraries[version].scanText(text);
      runsMs[version].push(performance.now() - start);
      const current = sha(JSON.stringify(scan));
      if (digest !== undefined) assert.equal(current, digest, `${name}/${n}: changed findings`);
      digest = current; findings = scan.findings.length;
    }
  }
  const result = { name, controlsPerHalf: n, codeUnits: text.length, bytes: Buffer.byteLength(text),
    inputSha256: sha(text), findings, identicalFindingsSha256: digest, runsMs,
    medianMs: Object.fromEntries(Object.entries(runsMs).map(([name, runs]) => [name, [...runs].sort((a, b) => a - b)[1]])) };
  results.push(result);
  console.log(JSON.stringify({ name, n, medianMs: result.medianMs, findings }));
}
await writeFile(output, JSON.stringify({ node: process.version, environment: '14 vCPU WSL2 Linux, 48 GB RAM; host not isolated',
  baselineBidiSha256: sha(await readFile(resolve(beforeRoot, 'dist/core/rules/bidi.js'))),
  currentBidiSha256: sha(await readFile(resolve(afterRoot, 'dist/core/rules/bidi.js'))),
  scope: 'Controlled dense-control stress inputs, not observed attacks or a production distribution. Full scanText; JSON hashing excluded from timings. Two small warmups per version; three timed scans per case.', results }, null, 2) + '\n');

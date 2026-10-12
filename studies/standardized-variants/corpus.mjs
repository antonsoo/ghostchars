// Compare full scans, sanitizer results and reveal output on the pinned public cache.
// node studies/standardized-variants/corpus.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw new Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const before = await import(pathToFileURL(resolve(beforeRoot, 'dist/index.js')));
const after = await import(pathToFileURL(resolve(afterRoot, 'dist/index.js')));
const census = resolve(dirname(fileURLToPath(import.meta.url)), '../prompt-census');
const manifestBytes = readFileSync(resolve(census, 'cache/manifest-full.json'));
const manifest = JSON.parse(manifestBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputDigest = createHash('sha256'), beforeDigest = createHash('sha256'), afterDigest = createHash('sha256');
let docs = 0, bytes = 0, oldFindings = 0, newFindings = 0, oldMs = 0, newMs = 0;
const changed = [];
for (const source of manifest.sources) {
  for (const [name, hash] of Object.entries(source.files).sort(([a], [b]) => a.localeCompare(b))) {
    const input = readFileSync(resolve(census, 'cache', source.id, name));
    assert.equal(sha(input), hash, `${source.id}/${name}: cached input differs from manifest`);
    const text = input.toString('utf8'), key = `${source.id}/${name}`;
    const start = performance.now(), old = before.scanText(text), middle = performance.now();
    const current = after.scanText(text), end = performance.now();
    oldMs += middle - start; newMs += end - middle;
    docs++; bytes += input.length;
    oldFindings += old.findings.length; newFindings += current.findings.length;
    inputDigest.update(`${key}\0${hash}\n`);
    const oldRepair = before.sanitize(text), newRepair = after.sanitize(text);
    const oldReveal = before.reveal(text), newReveal = after.reveal(text);
    const a = JSON.stringify({ scan: old, repair: oldRepair, revealed: oldReveal });
    const b = JSON.stringify({ scan: current, repair: newRepair, revealed: newReveal });
    beforeDigest.update(`${key}\0${a}\n`); afterDigest.update(`${key}\0${b}\n`);
    if (a !== b) {
      // Original-scan rules outside variation selectors remain unchanged.
      // Retain changed diagnostics/hashes without republishing source text.
      assert.deepEqual(current.findings.filter(f => !f.rule.startsWith('variation-selector')), old.findings.filter(f => !f.rule.startsWith('variation-selector')));
      const identify = f => `${f.rule}:${f.severity}:${f.start.offset}:${f.end.offset}`;
      const oldKeys = new Set(old.findings.map(identify)), newKeys = new Set(current.findings.map(identify));
      const oldDiagnostics = new Set(old.findings.map(f => JSON.stringify(f)));
      changed.push({ source: source.id, file: name, inputSha256: hash,
        before: old.findings.length, after: current.findings.length,
        added: current.findings.filter(f => !oldKeys.has(identify(f))),
        removed: old.findings.filter(f => !newKeys.has(identify(f))),
        diagnosticsChanged: current.findings.filter(f => oldKeys.has(identify(f)) && !oldDiagnostics.has(JSON.stringify(f))),
        repairExactlyEqual: JSON.stringify(oldRepair) === JSON.stringify(newRepair),
        repairedBeforeSha256: sha(oldRepair.text), repairedAfterSha256: sha(newRepair.text),
        revealExactlyEqual: oldReveal === newReveal });
    }
  }
  console.log(`${source.id}: ${docs} documents checked`);
}
const result = { node: process.version, manifestSha256: sha(manifestBytes),
  docs, bytes, inputSha256: inputDigest.digest('hex'),
  before: { findings: oldFindings, outputSha256: beforeDigest.digest('hex'), scanMs: oldMs },
  after: { findings: newFindings, outputSha256: afterDigest.digest('hex'), scanMs: newMs },
  timingScope: 'Initial scans only; repairs, reveal and hashing are outside scanMs. Baseline scans first. Not an isolated benchmark.',
  comparison: 'Exact full scan, complete sanitizer result (text, fixed and remaining findings), and reveal output.',
  changed, unrelatedOriginalScanRulesIdentical: true };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ docs, changed: changed.length, before: oldFindings, after: newFindings }));

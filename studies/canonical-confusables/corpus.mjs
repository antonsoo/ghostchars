// Compare two built libraries on the cached, hash-pinned public prompt census.
// node studies/canonical-confusables/corpus.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
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
    const a = JSON.stringify(old), b = JSON.stringify(current);
    beforeDigest.update(`${key}\0${a}\n`); afterDigest.update(`${key}\0${b}\n`);
    if (a !== b) {
      // Check that unrelated rules did not change. Keep complete changed diagnostics,
      // without republishing the prompt text from the original corpus.
      assert.deepEqual(current.findings.filter(f => f.rule !== 'confusable'), old.findings.filter(f => f.rule !== 'confusable'));
      const identify = f => `${f.rule}:${f.severity}:${f.start.offset}:${f.end.offset}`;
      const oldKeys = new Set(old.findings.map(identify)), newKeys = new Set(current.findings.map(identify));
      const oldDiagnostics = new Set(old.findings.map(f => JSON.stringify(f)));
      changed.push({ source: source.id, file: name, inputSha256: hash,
        before: old.findings.length, after: current.findings.length,
        added: current.findings.filter(f => !oldKeys.has(identify(f))),
        removed: old.findings.filter(f => !newKeys.has(identify(f))),
        diagnosticsChanged: current.findings.filter(f => oldKeys.has(identify(f)) && !oldDiagnostics.has(JSON.stringify(f))).length });
    }
  }
  console.log(`${source.id}: ${docs} documents checked`);
}
const result = { node: process.version, manifestSha256: sha(manifestBytes),
  docs, bytes, inputSha256: inputDigest.digest('hex'),
  before: { findings: oldFindings, outputSha256: beforeDigest.digest('hex'), scanMs: oldMs },
  after: { findings: newFindings, outputSha256: afterDigest.digest('hex'), scanMs: newMs },
  timingScope: 'One sequential local pass; baseline runs first for each input. Not an isolated benchmark.',
  changed, unrelatedRulesIdentical: true };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ docs, changed: changed.length, before: oldFindings, after: newFindings }));

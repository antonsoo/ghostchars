// Compare the public decoder and repair with independently parsed Unicode IVD records.
// node oracle.mjs PACKAGE_ROOT IVD_Sequences.txt OUTPUT.json [--full] [--verify]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageRoot, input, output] = process.argv.slice(2);
if (!output) throw new Error('Supply PACKAGE_ROOT IVD_FILE OUTPUT');
const root = resolve(packageRoot);
const api = await import(pathToFileURL(join(root, 'dist/index.js')));
const bytes = readFileSync(input);
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(bytes), '2b466659c2bfde1c52e60bd9fc883ab14dfa5c583df024b80352420265d2cd87');
const registered = new Map();
let registrations = 0;
for (const raw of bytes.toString('utf8').split('\n')) {
  const line = raw.split('#')[0].trim();
  if (!line) continue;
  const fields = line.split(';').map(value => value.trim());
  assert.equal(fields.length, 3);
  const pair = fields[0].split(/\s+/).map(value => Number.parseInt(value, 16));
  assert.equal(pair.length, 2);
  const [base, selector] = pair;
  assert.ok(selector >= 0xe0100 && selector <= 0xe01ef);
  registered.set(base * 256 + selector - 0xe0100, pair);
  registrations++;
}
const bases = [...new Set([...registered.values()].map(pair => pair[0]))].sort((a, b) => a - b);
const variants = text => api.scanText(text).findings.filter(f => f.rule.startsWith('variation-selector'));
const start = performance.now();
let rejected = 0, repaired = 0;
const failures = [];
for (const [base, selector] of registered.values()) {
  const text = String.fromCodePoint(base, selector);
  const findings = variants(text);
  const repair = api.sanitize(text).text;
  if (findings.length) rejected++;
  if (repair !== text) repaired++;
  if ((findings.length || repair !== text) && failures.length < 20) {
    failures.push({ base, selector, findings, repairedCodePoints: [...repair].map(c => c.codePointAt(0)) });
  }
}
console.log(`${registered.size} registered pairs checked; ${rejected} flagged, ${repaired} changed by repair`);
let matrix = null;
if (process.argv.includes('--full')) {
  matrix = { bases: bases.length, selectorsPerBase: 240, checked: 0, unexpectedQuiet: 0, unexpectedReported: 0, examples: [] };
  for (const [i, base] of bases.entries()) {
    for (let index = 0; index < 240; index++) {
      const expected = registered.has(base * 256 + index);
      const [run] = api.decodeVariationSelectors(String.fromCodePoint(base, 0xe0100 + index));
      assert.ok(run);
      const actual = run.isOrdinaryPresentationSelector;
      matrix.checked++;
      if (actual !== expected) {
        if (actual) matrix.unexpectedQuiet++;
        else matrix.unexpectedReported++;
        if (matrix.examples.length < 20) matrix.examples.push({ base, selector: 0xe0100 + index, expected, actual });
      }
    }
    if (i % 2048 === 0) console.log(`Registry matrix: ${i + 1}/${bases.length} bases`);
  }
}
const builtFiles = {};
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && path.endsWith('.js')) builtFiles[relative(root, path)] = sha(readFileSync(path));
  }
}
visit(join(root, 'dist'));
const result = {
  scope: 'Pinned IVD registration/repair oracle, not a safety or font-rendering claim. Each registered pair is scanned separately.',
  runtime: { node: process.version, icu: process.versions.icu, unicode: process.versions.unicode },
  ivd: { version: '2026-08-03', url: 'https://www.unicode.org/ivd/data/2026-08-03/IVD_Sequences.txt', sha256: sha(bytes), bytes: bytes.length, registrations, uniquePairs: registered.size, bases: bases.length },
  registered: { checked: registered.size, variationFindings: rejected, changedByRepair: repaired, examples: failures },
  matrix, builtFiles, seconds: (performance.now() - start) / 1000,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
if (process.argv.includes('--verify')) {
  assert.equal(rejected, 0);
  assert.equal(repaired, 0);
  if (matrix) {
    assert.equal(matrix.unexpectedQuiet, 0);
    assert.equal(matrix.unexpectedReported, 0);
  }
}

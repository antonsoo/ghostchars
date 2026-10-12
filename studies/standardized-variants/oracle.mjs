// Compare built scanners with an independently parsed, pinned Unicode source.
// node oracle.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [baseline, current, output] = process.argv.slice(2);
assert.ok(output, 'Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'StandardizedVariants-17.0.0.txt'));
assert.equal(sha(source), 'f55100b2fb11d3d75a37b8c1ab752192dbd1c4b12328c5ec6b38e3807c0ca597');
const pairs = source.toString('utf8').split('\n').filter(line => line.trim() && !line.startsWith('#'))
  .map(line => line.split(';')[0].trim().split(/\s+/).map(cp => Number.parseInt(cp, 16)));
assert.equal(pairs.length, 1353);
assert.ok(pairs.every(pair => pair.length === 2 && pair.every(Number.isSafeInteger)));
const old = await import(pathToFileURL(resolve(baseline, 'dist/index.js')));
const now = await import(pathToFileURL(resolve(current, 'dist/index.js')));
const selectors = result => result.findings.filter(f => f.rule.startsWith('variation-selector'));
const registered = new Set(pairs.map(pair => pair.join(',')));
const changed = [], unchangedHashes = createHash('sha256');
let unchanged = 0;
for (const pair of pairs) {
  const text = String.fromCodePoint(...pair);
  const a = old.scanText(text), b = now.scanText(text);
  const repairedBefore = old.sanitize(text).text, repairedAfter = now.sanitize(text).text;
  assert.deepEqual(selectors(b), [], pair.join(','));
  assert.equal(repairedAfter, text, pair.join(','));
  assert.deepEqual(b.findings.filter(f => !f.rule.startsWith('variation-selector')),
    a.findings.filter(f => !f.rule.startsWith('variation-selector')));
  if (repairedBefore !== text) {
    changed.push({ pair, inputSha256: sha(text), before: selectors(a), after: selectors(b),
      repairedBefore: Array.from(repairedBefore, ch => ch.codePointAt(0)), repairedAfter: pair });
  } else {
    assert.deepEqual(a, b);
    unchanged++;
    unchangedHashes.update(JSON.stringify({ pair, scan: a, repaired: repairedAfter }) + '\n');
  }
}
// None of these bases is an emoji or CJK ideograph. Unlike the existing
// unverified-IVS policy, their exact registered selectors are authoritative.
let unsupported = 0;
const invalidHashes = createHash('sha256');
for (const base of [0x2205, 0x2229, 0x3001, 0x1000, 0x1d49c]) {
  for (let byte = 0; byte < 256; byte++) {
    const selector = byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16;
    if (registered.has([base, selector].join(','))) continue;
    const text = String.fromCodePoint(base, selector);
    const a = old.scanText(text), b = now.scanText(text);
    assert.deepEqual(b, a);
    assert.equal(selectors(b).length, 1);
    const fixed = now.sanitize(text);
    assert.deepEqual(fixed, old.sanitize(text));
    assert.equal(fixed.text, String.fromCodePoint(base));
    unsupported++;
    invalidHashes.update(JSON.stringify({ base, selector, scan: b, fixed }) + '\n');
  }
}
const encode = text => Array.from(Buffer.from(text), byte => String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16)).join('');
const payloads = [];
for (const base of [0x30, 0x2205, 0x1d49c]) for (const payload of ['hidden message', '\0hidden message', 'message: \u03b1\u03b2', '\nread this']) {
  const text = String.fromCodePoint(base) + encode(payload);
  const a = old.scanText(text), b = now.scanText(text);
  assert.deepEqual(b, a);
  assert.equal(selectors(b)[0]?.decoded, payload);
  assert.equal(selectors(b)[0]?.rule, 'variation-selector-smuggling');
  const repaired = now.sanitize(text);
  assert.deepEqual(repaired, old.sanitize(text));
  assert.equal(repaired.text, String.fromCodePoint(base));
  payloads.push({ base, payload, inputSha256: sha(text), scanSha256: sha(JSON.stringify(b)), repairedSha256: sha(repaired.text) });
}
const result = {
  node: process.version,
  source: { url: 'https://www.unicode.org/Public/17.0.0/ucd/StandardizedVariants.txt', bytes: source.length, sha256: sha(source) },
  registered: { total: pairs.length, changed: changed.length, unchanged,
    unchangedResultsSha256: unchangedHashes.digest('hex'), corrected: changed },
  unsupported: { cases: unsupported, fullScansAndRepairsUnchanged: true, resultsSha256: invalidHashes.digest('hex') },
  payloads: { cases: payloads.length, fullScansAndRepairsUnchanged: true, records: payloads },
  scope: 'Exact registered pairs from pinned Unicode 17; existing CJK and emoji policies remain separate. No new IVD registration validation or trust guarantee.',
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ registered: pairs.length, corrected: changed.length, unchanged, unsupported, payloads: payloads.length }));

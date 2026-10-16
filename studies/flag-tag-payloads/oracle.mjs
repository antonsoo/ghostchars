// Check exact registered controls against a separately fetched Unicode data subset.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import assert from 'node:assert/strict';

const [modulePath, output, check] = process.argv.slice(2);
assert(modulePath && output, 'Use oracle.mjs LIBRARY OUTPUT [--check]');
const { scanText, sanitize } = await import(pathToFileURL(resolve(modulePath)).href);
const oracle = JSON.parse(await readFile(new URL('unicode-oracle.json', import.meta.url), 'utf8'));
const black = String.fromCodePoint(0x1f3f4), cancel = String.fromCodePoint(0xe007f);
const payloads = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
for (let first = 97; first <= 122; first++) {
  for (let second = 97; second <= 122; second++) payloads.push(String.fromCharCode(first, second));
}
let detected = 0, exactRepairs = 0;
for (const payload of payloads) {
  const wrapped = black + [...payload].map(char => String.fromCodePoint(0xe0000 + char.codePointAt(0))).join('') + cancel;
  detected += Number(scanText(wrapped).findings.some(finding => finding.rule === 'tag-smuggling'));
  exactRepairs += Number(sanitize(wrapped).text === black);
}
const flags = oracle.registered.map(row => {
  const value = String.fromCodePoint(...row.codepoints);
  return { ...row, findings: scanText(value).findings.length, unchanged: sanitize(value).text === value };
});
const result = { oracle_source: oracle.source, oracle_sha256: oracle.sha256,
  synthetic_unregistered_wrappers: payloads.length, detected, exact_repairs: exactRepairs, registered_flags: flags };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (check === '--check') {
  assert.equal(detected, payloads.length); assert.equal(exactRepairs, payloads.length);
  assert(flags.every(flag => flag.findings === 0 && flag.unchanged));
}

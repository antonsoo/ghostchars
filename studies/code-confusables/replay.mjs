// node studies/code-confusables/replay.mjs ROOT OUTPUT [--verify]
// Exercises built/installed code; native binding and skeleton expectations are
// captured independently by oracle.py. No source rewrites occur in the fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [root, output, verify] = process.argv.slice(2);
if (!root || !output || (verify && verify !== '--verify')) throw new Error('Supply ROOT OUTPUT [--verify]');
const directory = dirname(fileURLToPath(import.meta.url));
const oracleBytes = readFileSync(join(directory, 'results/oracle.json'));
const oracle = JSON.parse(oracleBytes);
const { scanText, sanitize } = await import(pathToFileURL(resolve(root, 'dist/index.js')));
const cli = resolve(root, 'dist/cli.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const invoke = (args, cwd = directory) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', maxBuffer: 5_000_000 });
  if (result.error || result.signal) throw result.error ?? new Error(`CLI signal: ${result.signal}`);
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
};
const codeFlagAvailable = invoke(['--help']).stdout.includes('--code');
const discrepancies = [], cases = [];
for (const row of oracle.cases) {
  const bytes = readFileSync(join(directory, row.file)), text = bytes.toString('utf8');
  assert.equal(sha(bytes), row.sha256, row.file);
  const plain = scanText(text), strict = scanText(text, { isCode: true });
  assert.deepEqual(plain.findings, []);
  const expected = [row.left, row.right, row.left, row.right];
  const actual = strict.findings.map(f => ({ text: text.slice(f.start.offset, f.end.offset),
    rule: f.rule, severity: f.severity, skeleton: f.skeleton, start: f.start, end: f.end, fixable: f.fixable }));
  const passed = actual.length === 4 && actual.every((f, i) => f.text === expected[i]
    && f.rule === 'confusable' && f.severity === 'error' && f.skeleton === row.skeleton && !f.fixable);
  if (!passed) discrepancies.push({ case: row.name, expected: 4, actual: actual.length });
  const clean = sanitize(text, { scanOptions: { isCode: true } });
  assert.equal(clean.text, text); assert.deepEqual(clean.fixed, []); assert.deepEqual(clean.remaining, strict.findings);
  const plainCLI = invoke([row.file, '--no-config', '--format', 'json']);
  assert.equal(plainCLI.exitCode, 0);
  assert.deepEqual(JSON.parse(plainCLI.stdout).results, []);
  let strictCLI = null;
  if (codeFlagAvailable) {
    const report = invoke([row.file, '--no-config', '--code', '--format', 'json']);
    assert.equal(report.exitCode, 1);
    const reportFindings = JSON.parse(report.stdout).results[0].findings;
    assert.deepEqual(reportFindings.map(f => ({ ...f, codePoints: f.codePoints.map(cp => Number.parseInt(cp.slice(2), 16)) })), strict.findings);
    strictCLI = { exitCode: report.exitCode, findings: reportFindings.length,
      reportSha256: sha(report.stdout), stderr: report.stderr };
  }
  cases.push({ name: row.name, file: row.file, sha256: sha(bytes), plainFindings: 0,
    nativeValues: row.nativeValues, strictFindings: actual, preservedBySanitize: true,
    plainCLI: { exitCode: plainCLI.exitCode, findings: 0 }, strictCLI });
}
const controls = ['a a', 'I l 1', 'rn m', 'a \u03b2', '\u03bb', '\u0430 \u0430'];
for (const text of controls) assert.deepEqual(scanText(text, { isCode: true }).findings, []);
const formats = {}, configuration = {};
if (codeFlagAvailable) {
  for (const format of ['pretty', 'summary', 'sarif', 'github']) {
    const result = invoke(['fixtures/latin-cyrillic-a.mjs', '--code', '--no-config', '--format', format]);
    assert.equal(result.exitCode, 1);
    if (format === 'sarif') assert.equal(JSON.parse(result.stdout).runs[0].results.length, 4);
    else assert.ok(result.stdout.includes('confusable'));
    formats[format] = { exitCode: result.exitCode, outputSha256: sha(result.stdout), bytes: Buffer.byteLength(result.stdout) };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ghostchars-code-confusables-'));
  try {
    const source = readFileSync(join(directory, 'fixtures/latin-cyrillic-a.mjs'), 'utf8');
    writeFileSync(join(scratch, 'input.mjs'), source);
    const config = (data) => writeFileSync(join(scratch, '.ghostcharsrc.json'), JSON.stringify(data));
    const run = (flags = []) => invoke(['input.mjs', '--format', 'json', ...flags], scratch);
    for (const [name, data, flags, expected] of [
      ['global', { isCode: true }, [], 1],
      ['matching-override', { overrides: [{ files: ['*.mjs'], isCode: true }] }, [], 1],
      ['later-false', { isCode: true, overrides: [{ files: ['*.mjs'], isCode: false }] }, [], 0],
      ['flag-wins', { isCode: false }, ['--code'], 1],
      ['rule-disabled', { isCode: true, rules: { confusable: false } }, [], 0],
    ]) {
      config(data);
      const result = run(flags);
      assert.equal(result.exitCode, expected);
      const findings = JSON.parse(result.stdout).summary.total;
      assert.equal(findings, expected ? 4 : 0);
      configuration[name] = { exitCode: result.exitCode, findings };
    }
    for (const [name, data] of [['invalid-global', { isCode: 'yes' }],
      ['invalid-override', { overrides: [{ files: ['*.mjs'], isCode: 1 }] }]]) {
      config(data); const result = run();
      assert.equal(result.exitCode, 2); assert.ok(result.stderr.includes('isCode must be a boolean'));
      configuration[name] = { exitCode: 2, diagnostic: 'isCode must be a boolean' };
    }
    config({ isCode: true });
    for (const flags of [['--fix', '--dry-run'], ['--fix']]) {
      const result = invoke(['input.mjs', ...flags], scratch);
      assert.equal(result.exitCode, 1); assert.equal(readFileSync(join(scratch, 'input.mjs'), 'utf8'), source);
    }
    configuration.confusablesNeverRenamed = true;
    writeFileSync(join(scratch, 'input.mjs'), source + '\u200b');
    assert.equal(run(['--fix']).exitCode, 1);
    assert.equal(readFileSync(join(scratch, 'input.mjs'), 'utf8'), source);
    configuration.unrelatedInvisibleRemoved = true;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const result = { schemaVersion: 1, node: process.version, oracleSha256: sha(oracleBytes),
  codeFlagAvailable, cases, controls, formats, configuration, discrepancies,
  scope: 'The code context is explicit. Default prose scans are unchanged; no source parser, binding resolver or automatic identifier renaming is claimed.' };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${cases.length} native pairs; ${discrepancies.length} discrepancies; --code ${codeFlagAvailable ? 'available' : 'unavailable'}`);
if (verify && (discrepancies.length || !codeFlagAvailable)) process.exitCode = 1;

// node studies/unicode-security-data/replay.mjs PACKAGE_ROOT OUTPUT [--verify]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [root, output, verify] = process.argv.slice(2);
assert.ok(root && output, 'Supply PACKAGE_ROOT OUTPUT [--verify]');
const study = dirname(fileURLToPath(import.meta.url));
const { scanText, sanitize } = await import(pathToFileURL(resolve(root, 'dist/index.js')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cyrillicApple = '\u0430\u0440\u0440\u04cf\u0435';
const definitions = [
  ['all-Cyrillic apple collision', `apple ${cyrillicApple}`, 2, 0, 'apple'],
  ['Cyrillic sha collision', 'window \u0448indow', 2, 1, 'window'],
  ['Cyrillic sha without counterpart', '\u0448indow', 0, 1, 'window'],
  ['obsolete palochka-to-i collision', `appie ${cyrillicApple}`, 0, 0, null],
  ['existing Cyrillic-a collision', 'paypal p\u0430ypal', 2, 1, 'paypal'],
  ['ASCII lookalikes stay out of scope', 'modern rnodern allow a11ow', 0, 0, null],
  ['canonical equivalents stay quiet', 'caf\u00e9 cafe\u0301', 0, 0, null],
  ['Greek symbols stay quiet', 'LaTeX2\u03b5 \u0394t 10\u03bcs', 0, 0, null],
];
const cases = definitions.map(([name, text, errors, warnings, skeleton]) => {
  const findings = scanText(text).findings;
  const actualErrors = findings.filter(f => f.severity === 'error').length;
  const actualWarnings = findings.filter(f => f.severity === 'warning').length;
  if (verify) {
    assert.equal(actualErrors, errors, name); assert.equal(actualWarnings, warnings, name);
    assert.equal(sanitize(text).text, text, name);
    for (const finding of findings) {
      assert.equal(finding.skeleton, skeleton, name); assert.equal(finding.fixable, false);
      assert.deepEqual(finding.codePoints, [...text.slice(finding.start.offset, finding.end.offset)].map(c => c.codePointAt(0)));
    }
  }
  return { name, text, inputSha256: hash(text), expected: { errors, warnings, skeleton }, actualErrors, actualWarnings, findings };
});
const fixture = resolve(study, 'fixtures/identifiers.mjs'), bytes = await readFile(fixture);
const execution = spawnSync(process.execPath, [fixture], { encoding: 'utf8' });
assert.equal(execution.status, 0); assert.equal(execution.stderr, '');
assert.deepEqual(JSON.parse(execution.stdout), ['intended', 'different', 'intended', 'different']);
const commands = [];
for (const format of ['json', 'sarif', 'github', 'summary']) {
  const result = spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), fixture, '--no-config', '--format', format], { encoding: 'utf8', cwd: study });
  assert.equal(result.error, undefined); assert.equal(result.stderr, '');
  if (verify) {
    assert.equal(result.status, 1, format);
    if (format === 'json') assert.deepEqual(JSON.parse(result.stdout).summary, {
      ...JSON.parse(result.stdout).summary, error: 8, warning: 2, total: 10, complete: true,
    });
  }
  commands.push({ format, exitCode: result.status, stdout: result.stdout.replaceAll(fixture, 'identifiers.mjs'), stderr: result.stderr });
}
const temporary = await mkdtemp(resolve(tmpdir(), 'ghostchars-unicode-data-'));
const repairs = [];
try {
  const copy = resolve(temporary, 'identifiers.mjs'); await writeFile(copy, bytes);
  for (const options of [['--fix', '--dry-run'], ['--fix']]) {
    const result = spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), copy, '--no-config', ...options], { encoding: 'utf8' });
    assert.equal(result.error, undefined); assert.deepEqual(await readFile(copy), bytes);
    if (verify) assert.equal(result.status, 1);
    repairs.push({ options, exitCode: result.status, sourceUnchanged: true });
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
assert.deepEqual(await readFile(fixture), bytes);
await writeFile(output, JSON.stringify({ node: process.version, unicode: process.versions.unicode, icu: process.versions.icu,
  cliSha256: hash(await readFile(resolve(root, 'dist/cli.js'))),
  tableSha256: hash(await readFile(resolve(root, 'dist/generated/confusables.js'))),
  source: { file: 'fixtures/identifiers.mjs', bytes: bytes.length, sha256: hash(bytes), execution: JSON.parse(execution.stdout) },
  cases, commands, repairs }, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length, changedCasesPassing: cases.filter(c => c.actualErrors === c.expected.errors && c.actualWarnings === c.expected.warnings).length,
  cliExitCodes: commands.map(c => c.exitCode), repairSourceUnchanged: repairs.every(r => r.sourceUnchanged) }));

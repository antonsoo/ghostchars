// node studies/canonical-confusables/replay.mjs PACKAGE_ROOT OUTPUT [--verify]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [root, output, verify] = process.argv.slice(2);
if (!output) throw new Error('Supply PACKAGE_ROOT OUTPUT [--verify]');
const study = dirname(fileURLToPath(import.meta.url));
const { scanText, sanitize } = await import(pathToFileURL(resolve(root, 'dist/index.js')));
const oracle = JSON.parse(await readFile(resolve(study, 'oracle.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [];
for (const row of oracle.cases) {
  const text = `${row.left} ${row.right}`;
  const scan = scanText(text);
  const collisions = scan.findings.filter(f => f.rule === 'confusable' && f.severity === 'error');
  if (verify) {
    assert.equal(collisions.length, row.expectedCollisions, row.name);
    for (const finding of collisions) {
      assert.equal(finding.skeleton, row.leftSkeleton, row.name);
      assert.equal(finding.fixable, false);
      assert.deepEqual(finding.codePoints, [...text.slice(finding.start.offset, finding.end.offset)].map(c => c.codePointAt(0)));
    }
    assert.equal(sanitize(text).text, text);
  }
  cases.push({ name: row.name, inputSha256: sha(text), expectedCollisions: row.expectedCollisions,
    collisions: collisions.length, findings: scan.findings });
}
const fixture = resolve(study, 'fixtures/identifiers.mjs');
const bytes = await readFile(fixture);
const execution = spawnSync(process.execPath, [fixture], { encoding: 'utf8' });
assert.equal(execution.status, 0);
assert.deepEqual(JSON.parse(execution.stdout), ['allowed', 'substituted']);
const commands = [];
for (const format of ['json', 'sarif', 'github', 'summary']) {
  const args = [resolve(root, 'dist/cli.js'), fixture, '--no-config', '--format', format];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  if (verify) assert.equal(result.status, 1, format);
  if (verify && format === 'json') {
    const findings = JSON.parse(result.stdout).results[0].findings;
    assert.equal(findings.filter(f => f.rule === 'confusable').length, 4);
  }
  commands.push({ command: `ghostchars identifiers.mjs --no-config --format ${format}`, exitCode: result.status,
    stdout: result.stdout.replaceAll(fixture, 'identifiers.mjs'), stderr: result.stderr });
}
assert.deepEqual(await readFile(fixture), bytes);
const repairDirectory = await mkdtemp(resolve(tmpdir(), 'ghostchars-canonical-repair-'));
const repairs = [];
try {
  const copy = resolve(repairDirectory, 'identifiers.mjs');
  await writeFile(copy, bytes);
  for (const extra of [['--fix', '--dry-run'], ['--fix']]) {
    const processResult = spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), copy, '--no-config', ...extra], { encoding: 'utf8' });
    assert.equal(processResult.error, undefined);
    assert.deepEqual(await readFile(copy), bytes);
    if (verify) assert.equal(processResult.status, 1);
    repairs.push({ options: extra, exitCode: processResult.status, sourceUnchanged: true });
  }
} finally { await rm(repairDirectory, { recursive: true, force: true }); }
await writeFile(output, JSON.stringify({ node: process.version, icu: process.versions.icu,
  unicode: process.versions.unicode, oracle: oracle.oracle, oracleIcu: oracle.icuVersion,
  librarySha256: sha(await readFile(resolve(root, 'dist/core/rules/confusables.js'))),
  cliSha256: sha(await readFile(resolve(root, 'dist/cli.js'))),
  source: { file: 'fixtures/identifiers.mjs', sha256: sha(bytes), bytes: bytes.length,
    execution: JSON.parse(execution.stdout), exitCode: execution.status }, cases, commands, repairs }, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length, mismatches: cases.filter(row => row.collisions !== row.expectedCollisions).map(row => row.name), cliExitCodes: commands.map(row => row.exitCode) }));

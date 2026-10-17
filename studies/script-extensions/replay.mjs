// Replay actual library diagnostics, CLI reports and repair without provider calls.
// node replay.mjs PACKAGE_ROOT OUTPUT [--verify]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output] = process.argv.slice(2);
if (!output) throw new Error('Supply PACKAGE_ROOT OUTPUT');
const verify = process.argv.includes('--verify');
const libraryOnly = process.argv.includes('--library-only');
const api = await import(pathToFileURL(resolve(root, 'dist/index.js')));
const sha = text => createHash('sha256').update(text).digest('hex');
const cases = [
  ['cyrillic-object', 'обʼєкт', []],
  ['cyrillic-play', 'пʼєса', []],
  ['cyrillic-connection', 'звʼязок', []],
  ['arabic-collision-control', 'يُعطى يُعطي', []],
  ['latin-diacritics-zwnj', 'a\u0308\u200c\u0308b', ['invisible']],
  ['latin-diacritics-zwj', 'a\u0308\u200d\u0308b', ['invisible']],
  ['cyrillic-with-greek-mark', 'а\u0342', ['confusable']],
  ['mixed-lookalike', 'paypаl', ['confusable']],
  ['persian-joining-control', 'می\u200cخواهم', []],
  ['persian-suffix-control', 'token\u200cها', []],
  ['virama-control', 'क्\u200dष', []],
];
const observations = [];
for (const [id, input, expected] of cases) {
  const findings = api.scanText(input).findings;
  const actual = findings.map(f => f.rule);
  const clean = id.startsWith('latin-diacritics') ? input.replace(/[\u200c\u200d]/u, '') : input;
  const repairs = ['remove', 'normalize'].map(mode => ({ mode, text: api.sanitize(input, { mode }).text }));
  if (verify) {
    assert.deepEqual(actual, expected, id);
    for (const repair of repairs) assert.equal(repair.text, clean, id);
    for (const finding of findings) assert.deepEqual(finding.codePoints, [...input.slice(finding.start.offset, finding.end.offset)].map(c => c.codePointAt(0)), id);
  }
  observations.push({ id, input, expected, actual, findings, repairs });
}
const directory = await mkdtemp(resolve(tmpdir(), 'ghostchars-scx-cli-'));
const commands = [];
try {
  const ordinary = 'обʼєкт пʼєса звʼязок\nيُعطى يُعطي';
  for (const [name, text, count] of libraryOnly ? [] : [['ordinary', ordinary, 0], ['joiners', 'a\u0308\u200c\u0308b\na\u0308\u200d\u0308b', 2]]) {
    const file = resolve(directory, name + '.txt');
    await writeFile(file, text);
    for (const format of ['json', 'sarif', 'github', 'summary']) {
      const result = spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), file, '--no-config', '--format', format], { encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.stderr, '');
      if (verify) assert.equal(result.status, 0, name + format);
      if (verify && format === 'json') assert.equal(JSON.parse(result.stdout).results.flatMap(row => row.findings).length, count);
      const stdout = result.stdout
        .replaceAll(pathToFileURL(file).href, name + '.txt')
        .replaceAll(relative(process.cwd(), file), name + '.txt')
        .replaceAll(file, name + '.txt');
      commands.push({ input: name, format, exitCode: result.status, stdout, stderr: result.stderr });
    }
    const run = extra => spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), file, '--no-config', '--fix', ...extra], { encoding: 'utf8' });
    const dry = run(['--dry-run']);
    assert.equal(dry.error, undefined);
    assert.equal(await readFile(file, 'utf8'), text);
    const fix = run([]);
    assert.equal(fix.error, undefined);
    const fixed = await readFile(file, 'utf8');
    if (verify) assert.equal(fixed, name === 'ordinary' ? ordinary : text.replace(/[\u200c\u200d]/gu, ''));
    commands.push({ input: name, repair: true, dryRunSourceUnchanged: true, dryExitCode: dry.status, fixExitCode: fix.status, output: fixed });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
await writeFile(output, JSON.stringify({ scope: (libraryOnly ? 'Library-only table-substitution prototype; CLI not measured. ' : 'Actual library and CLI. ') + 'Authored controls, including a pair observed in the unchanged public Arabic corpus. No language-parser, UTS #39 conformance or model-safety claim.',
  node: process.version, icu: process.versions.icu, unicode: process.versions.unicode,
  cliSha256: sha(await readFile(resolve(root, 'dist/cli.js'))),
  tableSha256: sha(await readFile(resolve(root, 'dist/generated/script-extensions.js'))),
  pathNormalization: 'Temporary absolute/file-URI and cwd-relative input paths replaced with their basenames in CLI stdout.',
  sourceHashes: Object.fromEntries(await Promise.all(['unicode-utils', 'rules/invisible', 'rules/confusables'].map(async file => [file, sha(await readFile(resolve(root, `dist/core/${file}.js`)))]))),
  observations, commands }, null, 2) + '\n');
console.log(`${observations.length} controls; ${observations.filter(row => JSON.stringify(row.actual) !== JSON.stringify(row.expected)).length} unexpected rule lists.`);

// Synthetic source programs, executed by native Node before and after real CLI repair.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  cli: { type: 'string' }, lib: { type: 'string' }, out: { type: 'string' },
  'observe-only': { type: 'boolean', default: false },
} });
if (!values.cli || !values.lib || !values.out) throw new Error('Use --cli PATH --lib PATH --out PATH');
const cli = resolve(values.cli), lib = resolve(values.lib);
const { sanitize } = await import(pathToFileURL(lib).href);
const spaces = [0xa0, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x202f, 0x205f, 0x3000];
const cases = spaces.map(cp => ({
  name: `return-U+${cp.toString(16).toUpperCase()}`,
  source: `function allowed() { return${String.fromCodePoint(cp)}false; }\nconsole.log(allowed());\n`,
  expected: 'function allowed() { return false; }\nconsole.log(allowed());\n',
}));
for (const cp of [0x2028, 0x2029]) cases.push({
  name: `comment-U+${cp.toString(16).toUpperCase()}`,
  source: `// Check below${String.fromCodePoint(cp)}process.exitCode = 7;\n`,
  expected: '// Check below\nprocess.exitCode = 7;\n',
});
cases.push(
  { name: 'allowlisted-nbsp', source: 'console.log(1\u00a0+ 1);\n', expected: 'console.log(1\u00a0+ 1);\n', config: { allow: ['U+00A0'] } },
  { name: 'disabled-whitespace', source: 'console.log(1\u00a0+ 1);\n', expected: 'console.log(1\u00a0+ 1);\n', config: { rules: { 'unusual-whitespace': false } } },
  { name: 'ordinary-ascii', source: 'console.log(false);\n', expected: 'console.log(false);\n' },
  { name: 'protected-typography', source: 'console.log("«\u00a0bonjour\u00a0» 漢\u3000字 ⠁\u2800⠃");\n', expected: 'console.log("«\u00a0bonjour\u00a0» 漢\u3000字 ⠁\u2800⠃");\n' },
);

const work = mkdtempSync(join(tmpdir(), 'ghostchars-whitespace-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const observations = [];
function run(args, cwd) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 10_000, env: { ...process.env, NO_COLOR: '1' } });
  if (r.error || r.signal) throw r.error ?? new Error(`child terminated: ${r.signal}`);
  return { exit: r.status, stdout: r.stdout.replaceAll(work, '<case-directory>'), stderr: r.stderr.replaceAll(work, '<case-directory>') };
}
try {
  for (const item of cases) {
    const dir = join(work, item.name); mkdirSync(dir);
    const file = join(dir, 'check.mjs'); writeFileSync(file, item.source);
    if (item.config) writeFileSync(join(dir, '.ghostcharsrc.json'), JSON.stringify(item.config));
    const original = run(['check.mjs'], dir);
    const args = [cli, 'check.mjs', '--fix', ...(item.config ? ['--config', '.ghostcharsrc.json'] : ['--no-config'])];
    const preview = run([...args, '--dry-run'], dir);
    const unchanged = readFileSync(file, 'utf8') === item.source;
    const repair = run([...args, '--format', 'json'], dir);
    const repaired = readFileSync(file, 'utf8');
    const executed = run(['check.mjs'], dir);
    const report = JSON.parse(repair.stdout);
    const changed = item.source !== item.expected;
    // These small single-finding examples retain the whole added source line.
    const expectedLines = item.expected.trimEnd().split('\n');
    const sourceLines = item.source.trimEnd().split('\n');
    const previewShowsPlan = !changed || expectedLines.filter(line => !sourceLines.includes(line)).every(line => preview.stdout.includes(`+ ${line}\n`));
    observations.push({
      name: item.name, source: item.source, expected: item.expected, config: item.config ?? null,
      originalExecution: original, preview, originalUnchangedAfterPreview: unchanged,
      previewShowsNormalizedPlan: previewShowsPlan, repair, repaired,
      repairedSha256: sha(Buffer.from(repaired)), repairedExecution: executed,
      reportComplete: report.summary.complete,
      agrees: unchanged && preview.exit === 0 && previewShowsPlan && repair.exit === 0
        && report.summary.complete && repaired === item.expected
        && original.exit === executed.exit && original.stdout === executed.stdout,
    });
  }
} finally { rmSync(work, { recursive: true, force: true }); }

const source = 'please\u00a0do\u2003not';
const library = [
  { mode: 'default', policy: {}, expected: 'pleasedonot' },
  { mode: 'remove', policy: { mode: 'remove' }, expected: 'pleasedonot' },
  { mode: 'keep', policy: { mode: 'keep' }, expected: source },
  { mode: 'normalize', policy: { mode: 'normalize' }, expected: 'please do not' },
].map(item => {
  const result = sanitize(source, item.policy);
  return { ...item, actual: result.text, fixed: result.fixed.length, remaining: result.remaining.length, agrees: result.text === item.expected };
});
const result = {
  node: process.version,
  population: 'Synthetic JavaScript programs and policy controls. Native Node executes before/after; no general language/semantic safety claim.',
  artifactSha256: { cli: sha(readFileSync(cli)), index: sha(readFileSync(lib)), sanitize: sha(readFileSync(join(dirname(lib), 'core/sanitize.js'))) },
  cliCases: observations.length, libraryCases: library.length,
  disagreements: observations.filter(x => !x.agrees).length + library.filter(x => !x.agrees).length,
  observations, library,
};
mkdirSync(dirname(resolve(values.out)), { recursive: true });
writeFileSync(values.out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ node: result.node, cliCases: result.cliCases, libraryCases: result.libraryCases, disagreements: result.disagreements }, null, 2));
if (result.disagreements && !values['observe-only']) process.exitCode = 1;

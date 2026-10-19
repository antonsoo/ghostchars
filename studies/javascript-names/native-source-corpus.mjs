// Compare parsed names with TypeScript's independent AST and the unchanged
// baseline confusable rule. Node --check validates every input's native grammar.
// Inputs come from the locked npm install; no dependency source is republished.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const [beforeRoot, afterRoot, output] = process.argv.slice(2);
if (!output) throw Error('Supply BASELINE_ROOT CURRENT_ROOT OUTPUT');
const require = createRequire(resolve(afterRoot, 'package.json'));
const ts = require('typescript');
const before = await import(pathToFileURL(resolve(beforeRoot, 'dist/index.js')));
const after = await import(pathToFileURL(resolve(afterRoot, 'dist/javascript.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['acorn', 'eslint', '@eslint/js', 'typescript'];
const packages = [], files = [];

function walk(folder) {
  const found = [];
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, item.name);
    if (item.isDirectory() && item.name !== 'node_modules') found.push(...walk(path));
    else if (item.isFile() && ['.js', '.mjs', '.cjs'].includes(extname(path))) found.push(path);
  }
  return found.sort();
}

function grammar(file, packageRoot) {
  if (extname(file) === '.mjs') return 'module';
  if (extname(file) === '.cjs') return 'commonjs';
  let folder = dirname(file);
  while (folder.startsWith(packageRoot)) {
    try {
      const data = JSON.parse(readFileSync(resolve(folder, 'package.json')));
      return data.type === 'module' ? 'module' : 'commonjs';
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    folder = dirname(folder);
  }
  throw Error('No package grammar');
}

function independentNames(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0, file);
  const byOffset = new Map(), pending = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      byOffset.set(node.getStart(tree), { name: node.text, start: node.getStart(tree), end: node.end,
        private: ts.isPrivateIdentifier(node) });
    }
    ts.forEachChild(node, child => { pending.push(child); });
  }
  return [...byOffset.values()].sort((a, b) => a.start - b.start);
}

const key = f => JSON.stringify([f.start.offset, f.end.offset, f.severity, f.skeleton, f.codePoints]);
function reference(tokens) {
  const expected = [];
  for (const isPrivate of [false, true]) {
    let virtual = '';
    const positions = new Map();
    for (const token of tokens.filter(t => t.private === isPrivate)) {
      positions.set(virtual.length, token);
      virtual += (isPrivate ? token.name.slice(1) : token.name) + '\n';
    }
    for (const finding of before.scanText(virtual, { isCode: true }).findings.filter(f => f.rule === 'confusable')) {
      const token = positions.get(finding.start.offset);
      assert.ok(token, 'Reference finding must select a complete name');
      assert.equal(finding.end.offset - finding.start.offset, token.name.length - Number(isPrivate));
      expected.push(key({ ...finding, start: { offset: token.start }, end: { offset: token.end },
        skeleton: (isPrivate ? '#' : '') + finding.skeleton,
        codePoints: isPrivate ? [35, ...finding.codePoints] : finding.codePoints }));
    }
  }
  return expected.sort();
}

for (const name of names) {
  const root = resolve(afterRoot, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(resolve(root, 'package.json')));
  packages.push({ name, version: metadata.version, license: metadata.license });
  for (const file of walk(root)) {
    const input = readFileSync(file), source = input.toString('utf8');
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    const tokens = independentNames(file, source);
    const result = after.scanJavaScript(source, { sourceType: grammar(file, root) });
    const findings = result.findings.filter(f => f.rule === 'confusable');
    assert.deepEqual(findings.map(key).sort(), reference(tokens), file);
    const ranges = new Set(tokens.map(t => `${t.start}:${t.end}`));
    const raw = before.scanText(source, { isCode: true }).findings.filter(f => f.rule === 'confusable');
    files.push({ file: relative(resolve(afterRoot), file), bytes: input.length, sha256: sha(input),
      grammar: grammar(file, root), node_check: true, typescript_identifiers: tokens.length,
      raw_confusable_findings: raw.length, raw_ranges_outside_identifiers: raw.filter(f => !ranges.has(`${f.start.offset}:${f.end.offset}`)).length,
      parsed_confusable_findings: findings.length, independent_reference_equal: true });
  }
  console.log(`${name}: ${files.length} native files checked`);
}
const sum = field => files.reduce((total, file) => total + file[field], 0);
const result = { node: process.version, typescript: ts.version, packages,
  script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  runtime_javascript: Object.fromEntries(walk(resolve(afterRoot, 'dist')).map(file => [relative(resolve(afterRoot), file), sha(readFileSync(file))])),
  lockfile_sha256: sha(readFileSync(resolve(afterRoot, 'package-lock.json'))),
  summary: { files: files.length, bytes: sum('bytes'), identifiers: sum('typescript_identifiers'),
    raw_confusable_findings: sum('raw_confusable_findings'), raw_ranges_outside_identifiers: sum('raw_ranges_outside_identifiers'),
    parsed_confusable_findings: sum('parsed_confusable_findings') },
  scope: 'Locked dependency source; independent parser/range consistency, not an attack-labelled or held-out accuracy benchmark.', files };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.summary));

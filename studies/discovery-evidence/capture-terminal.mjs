// Render captured CLI output as a terminal image; the text is not a mockup.
// npm ci --prefix web; node studies/discovery-evidence/capture-terminal.mjs dist/cli.js
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('playwright');
const cli = resolve(process.argv[2] ?? 'dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'ghostchars-terminal-'));
const sections = [];
const invoke = (args, cwd = root) => {
  const run = spawnSync(process.execPath, [cli, ...args, '--no-config'], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  if (run.error) throw run.error;
  sections.push(`$ node <built-cli> ${args.join(' ')} --no-config\n${run.stdout}${run.stderr}exit: ${run.status}`.replaceAll(root, '<fixture>'));
  return run;
};
let browser;
try {
  writeFileSync(join(root, 'denied.txt'), 'plain text');
  chmodSync(join(root, 'denied.txt'), 0);
  try {
    if (invoke(['denied.txt', '--format', 'summary']).status !== 2) throw new Error('Permissions were not enforced');
  } finally { chmodSync(join(root, 'denied.txt'), 0o600); }

  const outside = 'a\u202eb\u202c';
  writeFileSync(join(root, 'outside.txt'), outside);
  mkdirSync(join(root, 'repo'));
  symlinkSync('../outside.txt', join(root, 'repo', 'link.txt'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', join(root, 'repo'), ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git('init', '-q', '-b', 'main'); git('add', '.');
  if (invoke(['.', '--fix', '--format', 'summary'], join(root, 'repo')).status !== 0) throw new Error('Unexpected linked-file result');
  const unchanged = readFileSync(join(root, 'outside.txt'), 'utf8') === outside;
  if (!unchanged) throw new Error('Outside fixture was modified');
  sections.push('Filesystem check: the outside symlink target is byte-for-byte unchanged.');

  const text = sections.join('\n\n') + '\n';
  writeFileSync(new URL('./results/terminal.txt', import.meta.url), text);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset="utf-8"><title>Captured Ghostchars CLI output</title><style>body{margin:0;padding:32px;background:#101518;color:#e5edf0;font:17px/1.65 ui-monospace,monospace}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}h1{font:600 16px ui-monospace,monospace;color:#b9c7ce;margin:0 0 24px}</style><h1>GHOSTCHARS / ACTUAL CLI OUTPUT / UNIX FILESYSTEM CONTROLS</h1><pre></pre>');
  await page.locator('pre').evaluate((element, content) => { element.textContent = content; }, text);
  const assets = fileURLToPath(new URL('../../docs/assets/', import.meta.url));
  mkdirSync(assets, { recursive: true });
  await page.screenshot({ path: join(assets, 'discovery-errors.png'), fullPage: true });
} finally {
  if (browser) await browser.close();
  rmSync(root, { recursive: true, force: true });
}

// node studies/unicode-security-data/browser.mjs DIST OUTPUT before|after SCREENSHOTS
/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { URL } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium, firefox } = require('playwright');
const AxeBuilder = require('@axe-core/playwright');
const [dist, output, mode, screenshots] = process.argv.slice(2);
assert.ok(dist && output && screenshots && ['before', 'after'].includes(mode));
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), assets = new Map();
async function load(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await load(join(directory, entry.name), prefix + entry.name + '/');
    else assets.set('/ghostchars/' + prefix + entry.name, await readFile(join(directory, entry.name)));
  }
}
await load(resolve(dist)); await mkdir(screenshots, { recursive: true });
const source = await readFile(new URL('./fixtures/identifiers.mjs', import.meta.url), 'utf8');
const obsolete = 'appie \u0430\u0440\u0440\u04cf\u0435';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const server = createServer((request, response) => {
        let path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/ghostchars/') path += 'index.html';
        const body = assets.get(path);
        response.writeHead(body ? 200 : 404, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(body ?? 'Not found');
      });
      await new Promise(done => server.listen(0, '127.0.0.1', done));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        await new Promise(done => { server.close(done); server.closeAllConnections(); }); stopped = true;
      };
      try {
        const page = await context.newPage(), errors = [], lateRequests = [], external = [], pending = [], served = {}, cases = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
          if (!/^https?:/.test(request.url())) return;
          if (stopped) lateRequests.push(request.url());
          if (new URL(request.url()).origin !== origin) external.push(request.url());
        });
        page.on('response', response => {
          if (!/^https?:/.test(response.url())) return;
          pending.push((async () => {
            let path = new URL(response.url()).pathname; if (path === '/ghostchars/') path += 'index.html';
            const body = await response.body(); assert.equal(sha(body), sha(assets.get(path)));
            served[path] = { bytes: body.length, sha256: sha(body) };
          })());
        });
        await page.addInitScript(() => {
          window.violations = []; document.addEventListener('securitypolicyviolation', event => window.violations.push(event.violatedDirective));
        });
        await page.goto(origin + '/ghostchars/');
        await page.waitForFunction(() => /^Scanned /.test(document.querySelector('#scan-status').textContent) && document.querySelector('#input').getAttribute('aria-busy') === 'false');
        // Fonts use lazy unicode-range subsets. Load these glyphs explicitly so
        // the offline before/after captures use the same packaged faces.
        await page.evaluate(async text => {
          await Promise.all([document.fonts.load('16px "IBM Plex Mono"', text), document.fonts.load('16px Inter', text)]);
        }, source);
        await Promise.all(pending); await stop(); await context.setOffline(true);
        for (const [name, text, count] of [['new collisions', source, mode === 'after' ? 10 : 0], ['obsolete collision', obsolete, mode === 'after' ? 0 : 2]]) {
          await page.getByLabel('Text to inspect').fill(text);
          await page.waitForFunction(({ text, count }) => document.querySelector('#sanitized-output').value === text &&
            document.querySelector('#input').getAttribute('aria-busy') === 'false' && document.querySelector('#scan-status').textContent.includes(`${count} finding`), { text, count });
          const locations = page.locator('#all-findings button.loc'); assert.equal(await locations.count(), count);
          const selected = [];
          for (let i = 0; i < count; i++) {
            await locations.nth(i).focus(); await page.keyboard.press('Enter');
            const selection = await page.locator('#input').evaluate(node => ({ focused: document.activeElement === node, text: node.value.slice(node.selectionStart, node.selectionEnd) }));
            assert.ok(selection.focused); selected.push(selection.text);
          }
          if (name === 'new collisions' && mode === 'after') assert.deepEqual(selected, ['apple', '\u0430\u0440\u0440\u04cf\u0435', 'window', '\u0448indow', '\u0448indow', 'apple', '\u0430\u0440\u0440\u04cf\u0435', 'window', '\u0448indow', '\u0448indow']);
          await page.locator('#select-clean').focus(); await page.keyboard.press('Enter');
          const copied = await page.locator('#sanitized-output').evaluate(node => node.value.slice(node.selectionStart, node.selectionEnd));
          assert.equal(copied, text);
          const status = await page.locator('#scan-status').textContent();
          cases.push({ name, inputSha256: sha(text), findings: count, status, selected, sanitizedTextUnchanged: true, outputSelectionUnchanged: true });
          if (name === 'new collisions') {
            await page.locator('#scan-status').evaluate(node => { node.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
            await page.screenshot({ path: resolve(screenshots, `${engine}-${width}.png`) });
            assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
          }
        }
        assert.deepEqual(errors, []); assert.deepEqual(lateRequests, []); assert.deepEqual(external, []);
        assert.deepEqual(await page.evaluate(() => window.violations), []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        results.push({ engine, browserVersion: browser.version(), width, serverStoppedBeforeNewInput: true, glyphFontsLoadedBeforeOffline: true,
          cases, served, errors, lateRequests, external, cspViolations: [], axeViolations: 0, horizontalOverflow: false });
      } finally { await stop(); await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ mode, results, scope: 'Built offline worker and keyboard text selection, with the fixture glyph font subsets loaded before disconnection. The operating-system clipboard is not read.' }, null, 2) + '\n');
console.log(`${mode}: ${results.length} browser contexts and ${results.length * 2} scans verified`);

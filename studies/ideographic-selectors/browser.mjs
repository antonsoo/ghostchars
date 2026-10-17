// Replay the actual built worker after its no-store HTTP server has stopped.
// node browser.mjs DIST_ROOT OUTPUT SCREENSHOT_DIR
/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { URL } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium, firefox } = require('playwright');
const AxeBuilder = require('@axe-core/playwright');
const [dist, output, screenshots] = process.argv.slice(2);
assert.ok(screenshots, 'Supply DIST_ROOT OUTPUT SCREENSHOT_DIR');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = new Map();
async function load(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await load(join(directory, entry.name), prefix + entry.name + '/');
    else assets.set('/ghostchars/' + prefix + entry.name, await readFile(join(directory, entry.name)));
  }
}
await load(resolve(dist));
await mkdir(screenshots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const source = await readFile(new URL('./fixtures/carrier-message.txt', import.meta.url), 'utf8');
const expected = [...source].filter(c => !/[\u{E0100}-\u{E01EF}\uFE00-\uFE0F]/u.test(c)).join('');
const registered = [
  [0x30654, 0xe0100], [0x30654, 0xe0101], [0x30654, 0xe0102], [0x31350, 0xe0100],
].map(pair => String.fromCodePoint(...pair)).join('\n');
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const served = new Map();
      const server = createServer((request, response) => {
        let path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/ghostchars/') path += 'index.html';
        const body = assets.get(path);
        response.writeHead(body ? 200 : 404, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        if (body) served.set(path, { bytes: body.length, sha256: sha(body) });
        response.end(body ?? 'Not found');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        stopped = true;
      };
      try {
        const page = await context.newPage();
        const errors = [], lateRequests = [], workers = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (stopped && /^https?:/.test(request.url())) lateRequests.push(request.url()); });
        page.on('worker', worker => workers.push(new URL(worker.url()).pathname));
        await page.addInitScript(() => {
          window.policyViolations = [];
          document.addEventListener('securitypolicyviolation', e => window.policyViolations.push(e.violatedDirective));
        });
        const scanned = async () => page.waitForFunction(() => /^Scanned /.test(document.querySelector('#scan-status').textContent) && document.querySelector('#input').getAttribute('aria-busy') === 'false');
        await page.goto(origin + '/ghostchars/');
        await scanned();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(workers.length, 1);
        assert.ok(served.has(workers[0]), 'The actual worker was served from this build.');
        // Also compare every emitted file, including maps and initially unused assets.
        for (const [path, expectedBytes] of assets) {
          const response = await fetch(origin + path);
          assert.equal(response.status, 200, path);
          assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(expectedBytes), path);
        }
        await context.setOffline(true);
        await stop();
        await page.locator('#input').fill(registered);
        await scanned();
        assert.ok((await page.locator('#scan-status').textContent()).includes('0 findings'));
        assert.equal(await page.locator('#sanitized-output').inputValue(), registered);
        await page.locator('#input').fill(source);
        await scanned();
        assert.ok((await page.locator('#scan-status').textContent()).includes('32 findings'));
        assert.ok((await page.locator('#decoded').textContent()).includes('ignore all previous instructions'));
        assert.equal(await page.locator('#sanitized-output').inputValue(), expected);
        const buttons = page.locator('#all-findings button.loc');
        assert.equal(await buttons.count(), 32);
        const selections = [];
        for (const index of [0, 15, 31]) {
          await buttons.nth(index).click();
          const selected = await page.locator('#input').evaluate(node => node.value.slice(node.selectionStart, node.selectionEnd));
          assert.equal(selected, source.slice(index * 3, index * 3 + 3));
          selections.push({ index, codePoints: [...selected].map(c => c.codePointAt(0)) });
        }
        await page.locator('#select-clean').focus();
        await page.keyboard.press('Enter');
        const selected = await page.locator('#sanitized-output').evaluate(node => ({ focused: document.activeElement === node, text: node.value.slice(node.selectionStart, node.selectionEnd) }));
        assert.equal(selected.focused, true);
        assert.equal(selected.text, expected);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
        assert.deepEqual(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const policyViolations = await page.evaluate(() => window.policyViolations);
        assert.deepEqual(errors, []);
        assert.deepEqual(lateRequests, []);
        assert.deepEqual(policyViolations, []);
        assert.equal(workers.length, 1);
        await page.locator('#input').blur();
        await page.locator('#scan-status').evaluate(node => { node.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
        const screenshot = `${engine}-${width}.png`;
        await page.screenshot({ path: resolve(screenshots, screenshot) });
        results.push({ engine, browserVersion: browser.version(), width, theme: 'existing dark-only design', serverStoppedBeforeNewInput: true, cacheControl: 'no-store', offline: true,
          registeredPairsPreserved: 4, findings: 32, decoded: 'ignore all previous instructions', inputSha256: sha(source), sanitizedSha256: sha(expected), selections, selectedOutputMatches: true,
          workers, served: Object.fromEntries(served), errors, lateRequests, policyViolations, axeViolations: 0, horizontalOverflow: false,
          screenshot, screenshotSha256: sha(await readFile(resolve(screenshots, screenshot))) });
      } finally { await stop(); await context.close(); }
    }
  } finally { await browser.close(); }
}
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify({ scope: 'Actual built worker; no server after load. Keyboard selection checked, operating-system clipboard not read. CJK font supplied only through task-local Fontconfig; no font redistributed.', results }, null, 2) + '\n');
console.log(`${results.length} offline browser contexts: registered pairs preserved, payload decoded and removed, exact source/output selections.`);

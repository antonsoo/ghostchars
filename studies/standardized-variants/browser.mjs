// Actual built worker, with the no-store HTTP server stopped before new input.
// node browser.mjs DIST_ROOT OUTPUT baseline|verify SCREENSHOT_DIR
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium, firefox } = require('playwright');
const AxeBuilder = require('@axe-core/playwright');
const [dist, output, mode, screenshots] = process.argv.slice(2);
assert.ok(['baseline', 'verify'].includes(mode));
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
const registered = '0\uFE00\n\u2205\uFE00\n\u3001\uFE01\n\u1000\uFE00\n';
const oldRegistered = '0\n\u2205\n\u3001\n\u1000\n';
const payload = Array.from(Buffer.from('hidden message'), b => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join('');
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
      const context = await browser.newContext({ viewport: { width, height: 950 } });
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
        await page.goto(origin + '/ghostchars/');
        await page.waitForFunction(() => /^Scanned /.test(document.querySelector('#scan-status').textContent) && document.querySelector('#input').getAttribute('aria-busy') === 'false');
        await page.evaluate(() => document.fonts.ready);
        assert.equal(workers.length, 1);
        assert.ok(served.has(workers[0]), 'The real worker script was served from this build.');
        await context.setOffline(true);
        await stop();
        const cases = [];
        for (const mixed of [false, true]) {
          const input = registered + (mixed ? '\u2205' + payload : '');
          const expected = (mode === 'baseline' ? oldRegistered : registered) + (mixed ? '\u2205' : '');
          await page.locator('#input').fill(input);
          await page.waitForFunction(expected => document.querySelector('#sanitized-output').value === expected && document.querySelector('#input').getAttribute('aria-busy') === 'false', expected);
          const status = await page.locator('#scan-status').textContent();
          const count = (mode === 'baseline' ? 4 : 0) + (mixed ? 1 : 0);
          assert.ok(status.includes(`${count} finding`), status);
          assert.equal(await page.locator('#all-findings button.loc').count(), count);
          if (mixed) assert.ok((await page.locator('#decoded').textContent()).includes('hidden message'));
          await page.locator('#select-clean').focus();
          await page.keyboard.press('Enter');
          const selection = await page.locator('#sanitized-output').evaluate(node => ({ focused: document.activeElement === node, text: node.value.slice(node.selectionStart, node.selectionEnd) }));
          assert.equal(selection.focused, true);
          assert.equal(selection.text, expected);
          cases.push({ mixed, inputSha256: sha(input), sanitizedSha256: sha(expected), selectedTextSha256: sha(selection.text), status, findings: count, outputFocused: true });
          const captureMixed = (engine === 'chromium' && width === 375) || (engine === 'firefox' && width === 1440);
          if (mixed === captureMixed) {
            await page.locator('#scan-status').evaluate(node => { node.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
            await page.screenshot({ path: resolve(screenshots, `${engine}-${width}.png`) });
          }
        }
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
        assert.deepEqual(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const policyViolations = await page.evaluate(() => window.policyViolations);
        assert.deepEqual(errors, []);
        if (mode === 'verify') assert.deepEqual(lateRequests, [], `${engine}/${width}`);
        assert.deepEqual(policyViolations, []);
        assert.equal(workers.length, 1);
        const screenshot = `${engine}-${width}.png`;
        results.push({ engine, browserVersion: browser.version(), width, serverStoppedBeforeNewInput: true,
          cacheControl: 'no-store', offline: true, cases, workers, served: Object.fromEntries(served),
          errors, lateRequests, policyViolations, axeViolations: 0, horizontalOverflow: false,
          screenshot, screenshotSha256: sha(await readFile(resolve(screenshots, screenshot))) });
      } finally { await stop(); await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ mode, results, scope: 'Actual built worker. Server stopped before edits. Keyboard output selection is checked; the operating-system clipboard is not read.' }, null, 2) + '\n');
console.log(`${results.length} offline browser contexts / ${results.length * 2} scan-and-selection workflows passed (${mode}).`);

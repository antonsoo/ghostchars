import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

declare global {
  interface Window {
    __csp: string[];
    __holdScans: boolean;
    __queuedScans: (() => void)[];
    __workerCount: number;
    __copied: string;
    __finishCopy: () => void;
  }
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4322/')) failures.push(`External request: ${request.url()}`);
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__csp.push(event.violatedDirective));
    window.__holdScans = false;
    window.__queuedScans = [];
    window.__workerCount = 0;
    const NativeWorker = window.Worker;
    // Keep the real worker and scanner; hold delivery only when a race test asks.
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        window.__workerCount++;
      }
      override postMessage(message: unknown): void {
        if (window.__holdScans) window.__queuedScans.push(() => super.postMessage(message));
        else super.postMessage(message);
      }
    };
  });
  await page.goto('./');
  await scanned(page);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

async function scanned(page: Page): Promise<void> {
  await expect(page.locator('#scan-status')).toHaveText(/^Scanned /);
  await expect(page.locator('#input')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Copy sanitized text', exact: true })).toBeEnabled();
}

async function inspect(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Text to inspect', exact: true }).fill(text);
  await scanned(page);
}

async function holdScan(page: Page, text: string): Promise<void> {
  await page.evaluate(() => { window.__holdScans = true; });
  await page.locator('#input').fill(text);
  await expect.poll(() => page.evaluate(() => window.__queuedScans.length)).toBeGreaterThan(0);
  await expect(page.locator('#scan-status')).toHaveText('Scanning locally…');
}

test('overlapping findings remain visible and sanitized lookalikes remain explicit', async ({ page }) => {
  await inspect(page, 'p\u200d\u0430ypal');
  await expect(page.locator('#revealed .gc-confusable .gc-chip')).toHaveCount(1);
  expect(await page.locator('#revealed').innerHTML()).not.toContain('\u200d');
  await expect(page.getByRole('textbox', { name: 'Sanitized text', exact: true })).toHaveValue('p\u0430ypal');
  await expect(page.locator('#sanitized-summary')).toContainText('review the lookalikes');
  await expect(page.locator('#remaining-findings')).toContainText('confusable');
});

test('decoded display controls and markup stay inert', async ({ page }) => {
  const payload = '<img src=x onerror=alert(1)>\u202e\u200b';
  const selectors = [...new TextEncoder().encode(payload)].map((byte) => String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16)).join('');
  await inspect(page, 'A' + selectors);
  await expect(page.locator('#bidi-logical')).toContainText('\\u{202E}');
  await expect(page.locator('#bidi-logical')).toContainText('\\u{200B}');
  expect(await page.locator('#bidi-logical').textContent()).not.toMatch(/[\u202e\u200b]/u);
  expect(await page.locator('#revealed').innerHTML()).not.toMatch(/[\u202e\u200b]/u);
  await expect(page.locator('#revealed img, #decoded img')).toHaveCount(0);
});

test('finding locations select the exact UTF-16 range after an astral character', async ({ page }) => {
  const source = '🧪 p\u200d\u0430ypal';
  await inspect(page, source);
  const location = page.locator('#all-findings').getByRole('button', { name: /Select invisible/ });
  await location.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#input')).toBeFocused();
  expect(await page.locator('#input').evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('\u200d');
});

test('clipboard rejection selects actual sanitized text for manual copying', async ({ page }) => {
  await inspect(page, 'p\u0430ypal\u200b');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await page.getByRole('button', { name: 'Copy sanitized text', exact: true }).click();
  await expect(page.locator('#copy-status')).toContainText('press Ctrl+C or Command+C');
  await expect(page.locator('#sanitized-output')).toBeFocused();
  expect(await page.locator('#sanitized-output').evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('p\u0430ypal');
  await expect(page.locator('#copy-clean')).toBeEnabled();
});

test('copy sends complete sanitized output and manual selection works', async ({ page }) => {
  await inspect(page, 'keep\u200b this');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { window.__copied = text; } } }));
  await page.locator('#copy-clean').click();
  await expect(page.locator('#copy-status')).toContainText('Sanitized output copied.');
  expect(await page.evaluate(() => window.__copied)).toBe('keep this');
  await page.getByRole('button', { name: 'Select output', exact: true }).click();
  expect(await page.locator('#sanitized-output').evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 9]);
});

test('old clipboard completion cannot announce success for newly edited text', async ({ page }) => {
  await inspect(page, 'old\u200b');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>((resolve) => { window.__finishCopy = resolve; }) } }));
  await page.locator('#copy-clean').click();
  await expect(page.locator('#copy-status')).toContainText('Copying');
  await inspect(page, 'new\u200b');
  await page.evaluate(() => window.__finishCopy());
  await expect(page.locator('#copy-status')).toBeEmpty();
  await expect(page.locator('#sanitized-output')).toHaveValue('new');
  await expect(page.locator('#copy-clean')).toBeEnabled();
});

test('new input replaces held work and clears stale evidence immediately', async ({ page }) => {
  await holdScan(page, 'old\u200b');
  await expect(page.locator('#revealed')).toBeEmpty();
  await expect(page.locator('#sanitized-output')).toHaveValue('');
  await expect(page.locator('#copy-clean')).toBeDisabled();
  await page.evaluate(() => { window.__holdScans = false; });
  await inspect(page, 'new\u200d');
  await page.evaluate(() => window.__queuedScans.splice(0).forEach((send) => send()));
  await expect(page.locator('#sanitized-output')).toHaveValue('new');
  await expect(page.locator('#revealed')).toContainText('ZWJ');
  await expect(page.locator('#revealed')).not.toContainText('old');
});

test('cancelling keeps the page responsive and retry runs the current text', async ({ page }) => {
  await holdScan(page, 'cancel\u200b');
  await page.getByRole('button', { name: 'Cancel scan', exact: true }).click();
  await expect(page.locator('#scan-status')).toContainText('Scan cancelled');
  await expect(page.locator('#retry-scan')).toBeFocused();
  await expect(page.locator('#copy-clean')).toBeDisabled();
  await page.evaluate(() => { window.__holdScans = false; });
  await page.keyboard.press('Enter');
  await scanned(page);
  await expect(page.locator('#sanitized-output')).toHaveValue('cancel');
});

test('a worker load failure is recoverable without exposing stale results', async ({ page }) => {
  await holdScan(page, 'discard\u200b');
  await page.evaluate(() => { window.__holdScans = false; });
  await page.route('**/assets/scan.worker-*.js', (route) => route.abort());
  await page.locator('#input').fill('retry\u200b');
  await expect(page.locator('#retry-scan')).toBeVisible();
  await expect(page.locator('#scan-status')).toContainText('could not');
  await expect(page.locator('#sanitized-output')).toHaveValue('');
  await expect(page.locator('#copy-clean')).toBeDisabled();
  await page.unroute('**/assets/scan.worker-*.js');
  await page.locator('#retry-scan').click();
  await scanned(page);
  await expect(page.locator('#sanitized-output')).toHaveValue('retry');
});

test('oversized input is rejected before creating a worker and smaller input recovers', async ({ page }) => {
  const count = await page.evaluate(() => window.__workerCount);
  await page.locator('#input').fill(' '.repeat(100_001));
  await expect(page.locator('#scan-status')).toContainText('exceeds 100,000');
  expect(await page.evaluate(() => window.__workerCount)).toBe(count);
  await expect(page.locator('#copy-clean')).toBeDisabled();
  await expect(page.locator('#summary')).toBeEmpty();
  await expect(page.locator('#sanitized-output')).toHaveValue('');
  await inspect(page, 'small');
  await expect(page.locator('#sanitized-output')).toHaveValue('small');
});

test('dense input bounds rendering without truncating scan totals or copied output', async ({ page }) => {
  await inspect(page, 'a\u200b'.repeat(2000));
  await expect(page.locator('#scan-status')).toContainText('2,000 findings');
  await expect(page.locator('#all-findings button.loc')).toHaveCount(300);
  expect(await page.locator('#revealed .gc-chip').count()).toBeLessThanOrEqual(300);
  await expect(page.locator('#preview-note')).toContainText('sanitized output cover the complete input');
  await expect(page.locator('#all-findings .list-limit')).toContainText('300 of 2,000');
  await expect(page.locator('#sanitized-output')).toHaveValue('a'.repeat(2000));
});

test('lamp changes reuse cached evidence and clear removes previous text and findings', async ({ page }) => {
  const source = 'clear\u200b';
  await inspect(page, source);
  const workers = await page.evaluate(() => window.__workerCount);
  await page.locator('#lamp').click();
  await expect(page.locator('#lamp')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#revealed').textContent()).toBe(source);
  await page.locator('#lamp').click();
  await expect(page.locator('#revealed .gc-chip')).toHaveCount(1);
  expect(await page.evaluate(() => window.__workerCount)).toBe(workers);
  await page.getByRole('button', { name: 'Clear text', exact: true }).click();
  await scanned(page);
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('#input')).toBeFocused();
  await expect(page.locator('#sanitized-output')).toHaveValue('');
  await expect(page.locator('#all-findings button.loc')).toHaveCount(0);
  await expect(page.locator('#scan-status')).toContainText('0 code units');
});

test('scanning still works offline after the initial page has loaded', async ({ page, context }) => {
  await context.setOffline(true);
  await inspect(page, 'offline\u200b');
  await expect(page.locator('#sanitized-output')).toHaveValue('offline');
  await inspect(page, 'still offline\u200b');
  await page.locator('#lamp').click();
  await expect(page.locator('#revealed')).toHaveText('still offline\u200b');
});

for (const width of [1440, 375]) {
  test(`all gallery examples are accessible and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    for (let index = 0; index < 4; index++) {
      await page.locator('#example-select').selectOption(String(index));
      await scanned(page);
      await expect(page.locator('#all-findings button.loc').first()).toBeVisible();
      const audit = await new AxeBuilder({ page }).analyze();
      expect(audit.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

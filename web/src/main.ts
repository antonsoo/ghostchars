import type { FindingView, Inspection } from './inspection.js';
import type { ScanReply } from './scan.worker.js';
import { MAX_INPUT_CODE_UNITS } from './limits.js';
import { gallery } from './gallery.js';
import './fonts/fonts.css';
import './style.css';

const DEFAULT_TEXT = gallery[0]!.text;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span>ghostchars</div>
      <nav>
        <a href="https://github.com/antonsoo/ghostchars" target="_blank" rel="noopener">Source</a>
        <a href="https://github.com/antonsoo/ghostchars#readme" target="_blank" rel="noopener">Docs</a>
      </nav>
    </header>

    <main class="page-main">

    <section class="hero">
      <h1>See the characters <span class="glow">you can't</span>.</h1>
      <p>Paste code, docs, or an LLM prompt. ghostchars finds bidi overrides, zero-width
      characters, smuggled tag/variation-selector payloads, and homoglyph lookalikes --
      entirely in this tab.</p>
      <div class="privacy-note"><span class="dot" aria-hidden="true"></span>Your text stays in this tab. Scans run locally in a worker; fonts and code load from this site. No analytics or tracking.</div>
    </section>

    <div class="lamp-row">
      <button type="button" class="lamp-toggle" id="lamp" data-on="true" aria-pressed="true">
        <span class="bulb" aria-hidden="true"></span>
        <span id="lamp-label"><strong>UV lamp: on</strong> -- click to see the input as everyone else does</span>
      </button>
    </div>

    <div class="panel input-panel">
      <textarea id="input" spellcheck="false" autocapitalize="off" aria-label="Text to inspect"></textarea>
      <div class="input-toolbar">
        <select class="example-select" id="example-select" aria-label="Load an example">
          <option value="">Load an example…</option>
          ${gallery.map((g, i) => `<option value="${i}">${g.title}</option>`).join('')}
        </select>
        <button type="button" class="btn" id="clear-input">Clear text</button>
      </div>
    </div>

    <p class="input-limit">Up to 100,000 UTF-16 code units. Use the CLI for larger files.</p>
    <div class="scan-status"><p id="scan-status" role="status" aria-live="polite"></p><button type="button" class="btn" id="cancel-scan" hidden>Cancel scan</button><button type="button" class="btn" id="retry-scan" hidden>Retry scan</button></div>
    <div class="summary" id="summary"></div>
    <section class="section output-section" aria-labelledby="output-title">
      <h2 id="output-title">Sanitized output <span class="eyebrow">review before use</span></h2>
      <p class="desc">Fixable characters are removed. Lookalike identifiers are kept for you to review; sanitizing does not establish that text or code is safe.</p>
      <p id="sanitized-summary"></p>
      <label class="sr-only" for="sanitized-output">Sanitized text</label>
      <textarea id="sanitized-output" readonly spellcheck="false" aria-describedby="sanitized-summary"></textarea>
      <div class="output-toolbar"><button type="button" class="btn primary" id="copy-clean" disabled>Copy sanitized text</button><button type="button" class="btn" id="select-clean" disabled>Select output</button><span id="copy-status" role="status"></span></div>
      <div id="remaining-findings" tabindex="0" role="region" aria-label="Findings in sanitized text"></div>
    </section>
    <p id="preview-note" class="preview-note" hidden></p>

    <section class="section">
      <h2><span class="eyebrow">01</span> Revealed</h2>
      <p class="desc">Flagged characters become labelled chips, including those inside lookalike identifiers. Use a finding's location button to select its exact source range.</p>
      <div class="panel code-view" id="revealed" tabindex="0" role="region" aria-label="Revealed text"></div>
    </section>

    <section class="section" id="decoded-section">
      <h2><span class="eyebrow">02</span> Decoded payloads</h2>
      <p class="desc">Tag characters and variation-selector runs can encode arbitrary hidden bytes. Anything ghostchars can decode shows up here.</p>
      <div class="panel findings" id="decoded"></div>
    </section>

    <section class="section" id="bidi-section">
      <h2><span class="eyebrow">03</span> Bidi: what you see vs. what the compiler sees</h2>
      <p class="desc">The left pane is the input preview with your browser's real bidi algorithm applied -- if there's an override, it visually reorders right here. The right pane breaks that illusion by making every control character visible.</p>
      <div class="bidi-grid">
        <div class="bidi-pane rendered"><h3>What you see</h3><div class="content" id="bidi-rendered" tabindex="0" role="region" aria-label="Raw bidi preview"></div></div>
        <div class="bidi-pane"><h3>Logical order (what the compiler sees)</h3><div class="content" id="bidi-logical" tabindex="0" role="region" aria-label="Logical order preview"></div></div>
      </div>
    </section>

    <section class="section">
      <h2><span class="eyebrow">04</span> Confusables</h2>
      <p class="desc">Identifiers that mix scripts, or that reduce to the same TR39 "skeleton" as another spelling elsewhere in the text.</p>
      <div class="panel findings" id="confusables"></div>
    </section>

    <section class="section">
      <h2><span class="eyebrow">05</span> All findings</h2>
      <div class="panel findings" id="all-findings"></div>
    </section>

    <section class="section">
      <h2>Example gallery</h2>
      <p class="desc">Four illustrative attack shapes. Choose one to inspect it above.</p>
      <div class="gallery" id="gallery"></div>
    </section>
    </main>

    <footer>
      <span>ghostchars -- MIT licensed -- <a href="https://github.com/antonsoo/ghostchars">github.com/antonsoo/ghostchars</a></span>
      <span>by Anton Soloviev</span>
    </footer>
  </div>
`;

const input = document.getElementById('input') as HTMLTextAreaElement;
const lampBtn = document.getElementById('lamp') as HTMLButtonElement;
const lampLabel = document.getElementById('lamp-label')!;
const revealedEl = document.getElementById('revealed')!;
const summaryEl = document.getElementById('summary')!;
const decodedEl = document.getElementById('decoded')!;
const confusablesEl = document.getElementById('confusables')!;
const allFindingsEl = document.getElementById('all-findings')!;
const bidiRenderedEl = document.getElementById('bidi-rendered')!;
const bidiLogicalEl = document.getElementById('bidi-logical')!;
const copyBtn = document.getElementById('copy-clean') as HTMLButtonElement;
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement;
const galleryEl = document.getElementById('gallery')!;

const sanitizedOutput = document.getElementById('sanitized-output') as HTMLTextAreaElement;
const sanitizedSummary = document.getElementById('sanitized-summary')!;
const remainingEl = document.getElementById('remaining-findings')!;
const copyStatus = document.getElementById('copy-status')!;
const selectClean = document.getElementById('select-clean') as HTMLButtonElement;
const scanStatus = document.getElementById('scan-status')!;
const cancelScan = document.getElementById('cancel-scan') as HTMLButtonElement;
const retryScan = document.getElementById('retry-scan') as HTMLButtonElement;
const previewNote = document.getElementById('preview-note')!;
let lampOn = true;
let worker: Worker | undefined;
let workerBusy = false;
let debounceHandle: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let inspection: Inspection | undefined;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const number = (value: number): string => value.toLocaleString('en-US');

function renderFindingsList(container: HTMLElement, findings: FindingView[], total: number, emptyText: string, source = true): void {
  container.innerHTML = findings.length === 0 ? `<div class="finding-row"><span class="msg">${emptyText}</span></div>` : findings.map((finding, index) => `
    <div class="finding-row">
      ${source ? `<button class="loc" type="button" data-finding="${index}" aria-label="Select ${finding.rule} at line ${finding.start.line}, column ${finding.start.column}">${finding.start.line}:${finding.start.column}</button>` : `<span class="loc">${finding.start.line}:${finding.start.column}</span>`}
      <span class="sev ${finding.severity}">${finding.severity}</span>
      <span class="msg"><strong>${finding.rule}</strong> -- ${escapeHtml(finding.message)}<span class="suggestion">${escapeHtml(finding.suggestion)}</span></span>
    </div>`).join('');
  if (total > findings.length) container.insertAdjacentHTML('beforeend', `<p class="list-limit">Showing ${number(findings.length)} of ${number(total)} findings. Use the CLI to inspect the complete list.</p>`);
  // Replace the old handler so it cannot retain the previous input's finding records.
  container.onclick = source ? (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-finding]');
    const finding = button ? findings[Number(button.dataset.finding)] : undefined;
    if (!finding) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(finding.start.offset, finding.end.offset);
    input.scrollIntoView({ block: 'center', behavior: 'instant' });
  } : null;
}

function renderLamp(): void {
  if (!inspection) return;
  if (lampOn) revealedEl.innerHTML = inspection.revealedHtml;
  else revealedEl.textContent = inspection.previewText || '(empty)';
}

function showResult(result: Inspection): void {
  inspection = result;
  const { counts } = result;
  summaryEl.innerHTML = result.totalFindings === 0 ? '<span class="chip-stat clean">No findings under the supported rules</span>' : [
    counts.error ? `<span class="chip-stat err">${number(counts.error)} error${counts.error === 1 ? '' : 's'}</span>` : '',
    counts.warning ? `<span class="chip-stat warn">${number(counts.warning)} warning${counts.warning === 1 ? '' : 's'}</span>` : '',
    counts.info ? `<span class="chip-stat">${number(counts.info)} info</span>` : '',
  ].join('');
  scanStatus.textContent = `Scanned ${number(input.value.length)} code units (${number(result.codePointCount)} code points); ${number(result.totalFindings)} finding${result.totalFindings === 1 ? '' : 's'}.`;
  renderLamp();
  renderFindingsList(decodedEl, result.decoded, result.decodedCount, 'No smuggled payloads decoded.');
  renderFindingsList(confusablesEl, result.confusables, result.confusableCount, 'No confusable identifiers found.');
  renderFindingsList(allFindingsEl, result.findings, result.totalFindings, 'No findings under the supported rules. This is not a safety guarantee.');
  bidiRenderedEl.textContent = result.previewText || '(empty)';
  bidiLogicalEl.textContent = result.logicalText || '(empty)';
  previewNote.hidden = result.previewUnits === input.value.length;
  previewNote.textContent = `Text previews show the first ${number(result.previewUnits)} of ${number(input.value.length)} code units, stopping before a finding would be split. The scan totals and sanitized output cover the complete input. Finding lists show at most 300 entries each.`;
  sanitizedOutput.value = result.sanitized.text;
  sanitizedSummary.textContent = `${number(result.sanitized.removedUnits)} code unit${result.sanitized.removedUnits === 1 ? '' : 's'} removed. ${number(result.sanitized.remainingCount)} finding${result.sanitized.remainingCount === 1 ? ' remains' : 's remain'}${result.sanitized.remainingCount ? ' -- review the lookalikes below before using this output.' : ' under the supported rules.'}`;
  remainingEl.hidden = result.sanitized.remainingCount === 0;
  renderFindingsList(remainingEl, result.sanitized.remaining, result.sanitized.remainingCount, '', false);
  copyBtn.disabled = false;
  selectClean.disabled = false;
}

function cancelWork(dispose = false): void {
  revision++;
  clearTimeout(debounceHandle);
  debounceHandle = undefined;
  // Reuse a settled worker so ordinary edits need no asset fetch or reinitialization.
  // An active scan must be terminated to release its text and stop obsolete work.
  if (workerBusy || dispose) {
    worker?.terminate();
    worker = undefined;
  }
  workerBusy = false;
  cancelScan.hidden = true;
  document.getElementById('input')!.setAttribute('aria-busy', 'false');
}

function clearResult(): void {
  inspection = undefined;
  for (const el of [revealedEl, summaryEl, decodedEl, confusablesEl, allFindingsEl, bidiRenderedEl, bidiLogicalEl, remainingEl]) {
    el.replaceChildren();
    el.onclick = null;
  }
  sanitizedOutput.value = '';
  sanitizedSummary.textContent = 'Scan the current input to prepare sanitized output.';
  copyStatus.textContent = '';
  copyBtn.disabled = true;
  selectClean.disabled = true;
  previewNote.hidden = true;
  previewNote.textContent = '';
}

function startScan(immediate = false): void {
  cancelWork();
  clearResult();
  retryScan.hidden = true;
  const currentRevision = revision;
  const text = input.value;
  // Check before structured-cloning text into a worker.
  if (text.length > MAX_INPUT_CODE_UNITS) {
    scanStatus.textContent = 'Input exceeds 100,000 UTF-16 code units. Use the CLI for larger files. Nothing was scanned or copied.';
    return;
  }
  scanStatus.textContent = 'Scanning locally…';
  cancelScan.hidden = false;
  input.setAttribute('aria-busy', 'true');
  const fail = (message: string): void => {
    if (revision !== currentRevision) return;
    cancelWork(true);
    scanStatus.textContent = message;
    retryScan.hidden = false;
  };
  const run = (): void => {
    try {
      const active = worker ?? new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
      worker = active;
      workerBusy = true;
      active.onerror = (event) => { event.preventDefault(); fail('The local scanner could not start. Retry the scan, or reload the page.'); };
      active.onmessageerror = () => fail('The local scanner returned an unreadable result. Retry the scan.');
      active.onmessage = ({ data }: MessageEvent<ScanReply>) => {
        if (revision !== currentRevision) return;
        workerBusy = false;
        active.onmessage = null;
        active.onerror = null;
        active.onmessageerror = null;
        cancelScan.hidden = true;
        input.setAttribute('aria-busy', 'false');
        if ('error' in data) fail(data.error);
        else showResult(data.result);
      };
      active.postMessage(text);
    } catch { fail('The local scanner is unavailable. Retry the scan, or use the CLI.'); }
  };
  if (immediate) run();
  else debounceHandle = setTimeout(run, 120);
}

lampBtn.addEventListener('click', () => {
  lampOn = !lampOn;
  lampBtn.dataset.on = String(lampOn);
  lampBtn.setAttribute('aria-pressed', String(lampOn));
  lampLabel.innerHTML = lampOn ? '<strong>UV lamp: on</strong> -- click to see the input as everyone else does' : '<strong>UV lamp: off</strong> -- click to reveal what is hiding';
  renderLamp();
});
input.addEventListener('input', () => startScan());
cancelScan.addEventListener('click', () => {
  cancelWork();
  clearResult();
  scanStatus.textContent = 'Scan cancelled. Edit the text or retry to inspect it.';
  retryScan.hidden = false;
  retryScan.focus();
});
retryScan.addEventListener('click', () => startScan(true));
document.getElementById('clear-input')!.addEventListener('click', () => {
  input.value = '';
  startScan(true);
  input.focus();
});

function selectOutput(): void {
  sanitizedOutput.focus();
  sanitizedOutput.select();
}
selectClean.addEventListener('click', selectOutput);
copyBtn.addEventListener('click', async () => {
  if (!inspection) return;
  const currentRevision = revision;
  const text = inspection.sanitized.text;
  copyBtn.disabled = true;
  copyStatus.textContent = 'Copying sanitized output…';
  try {
    await navigator.clipboard.writeText(text);
    if (revision === currentRevision) copyStatus.textContent = 'Sanitized output copied. Review any remaining findings before use.';
  } catch {
    if (revision === currentRevision) {
      copyStatus.textContent = 'Clipboard access failed. Sanitized output is selected; press Ctrl+C or Command+C to copy it.';
      selectOutput();
    }
  } finally {
    if (revision === currentRevision) copyBtn.disabled = false;
  }
});

function chooseExample(index: number): void {
  const item = gallery[index];
  if (!item) return;
  input.value = item.text;
  exampleSelect.value = '';
  startScan(true);
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'center' });
}
exampleSelect.addEventListener('change', () => { if (exampleSelect.value !== '') chooseExample(Number(exampleSelect.value)); });
galleryEl.innerHTML = gallery.map((item, index) => `<button type="button" class="specimen" data-index="${index}"><span class="tag">${item.lang}</span><span class="title">${item.title}</span><span class="desc">${item.description}</span></button>`).join('');
galleryEl.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
  if (button) chooseExample(Number(button.dataset.index));
});
window.addEventListener('pagehide', () => cancelWork(true));
window.addEventListener('pageshow', (event) => { if (event.persisted) startScan(true); });
input.value = DEFAULT_TEXT;
startScan(true);

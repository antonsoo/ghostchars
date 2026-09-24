import { reveal, sanitize, scanText } from '../../src/core/index.js';
import type { Finding } from '../../src/core/index.js';
import { gallery } from './gallery.js';
import { renderRevealedHtml } from './renderRevealed.js';
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

    <section class="hero">
      <h1>See the characters <span class="glow">you can't</span>.</h1>
      <p>Paste code, docs, or an LLM prompt. ghostchars finds bidi overrides, zero-width
      characters, smuggled tag/variation-selector payloads, and homoglyph lookalikes --
      entirely in this tab.</p>
      <div class="privacy-note"><span class="dot" aria-hidden="true"></span>Nothing you type or paste ever leaves your browser. No analytics, no tracking -- only Google Fonts loads over the network, for the typeface.</div>
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
        <button type="button" class="btn primary" id="copy-clean">Copy sanitized text</button>
      </div>
    </div>

    <div class="summary" id="summary"></div>

    <section class="section">
      <h2><span class="eyebrow">01</span> Revealed</h2>
      <p class="desc">Every flagged character becomes a labelled, glowing chip; hover one for the full explanation. Confusable identifiers stay as real text, underlined.</p>
      <div class="panel code-view" id="revealed"></div>
    </section>

    <section class="section" id="decoded-section">
      <h2><span class="eyebrow">02</span> Decoded payloads</h2>
      <p class="desc">Tag characters and variation-selector runs can encode arbitrary hidden bytes. Anything ghostchars can decode shows up here.</p>
      <div class="panel findings" id="decoded"></div>
    </section>

    <section class="section" id="bidi-section">
      <h2><span class="eyebrow">03</span> Bidi: what you see vs. what the compiler sees</h2>
      <p class="desc">The left pane is the raw text with your browser's real bidi algorithm applied -- if there's an override, it visually reorders right here. The right pane breaks that illusion by making every control character visible.</p>
      <div class="bidi-grid">
        <div class="bidi-pane rendered"><h3>What you see</h3><div class="content" id="bidi-rendered"></div></div>
        <div class="bidi-pane"><h3>Logical order (what the compiler sees)</h3><div class="content" id="bidi-logical"></div></div>
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
      <p class="desc">Four real attack shapes. Click one to load it above.</p>
      <div class="gallery" id="gallery"></div>
    </section>

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

let lampOn = true;

function severityLabel(sev: Finding['severity']): string {
  return sev === 'error' ? 'Error' : sev === 'warning' ? 'Warning' : 'Info';
}

function renderFindingsList(container: HTMLElement, findings: Finding[], emptyText: string) {
  if (findings.length === 0) {
    container.innerHTML = `<div class="finding-row"><span class="msg">${emptyText}</span></div>`;
    return;
  }
  container.innerHTML = findings
    .map(
      (f) => `
      <div class="finding-row">
        <span class="loc">${f.start.line}:${f.start.column}</span>
        <span class="sev ${f.severity}">${severityLabel(f.severity)}</span>
        <span class="msg"><strong>${f.rule}</strong> -- ${escapeHtml(f.message)}</span>
      </div>`,
    )
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let debounceHandle: ReturnType<typeof setTimeout> | undefined;

function scheduleRender() {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(render, 120);
}

function render() {
  const text = input.value;
  const { findings } = scanText(text);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  summaryEl.innerHTML =
    findings.length === 0
      ? `<span class="chip-stat clean">clean -- no findings</span>`
      : [
          counts.error ? `<span class="chip-stat err">${counts.error} error${counts.error === 1 ? '' : 's'}</span>` : '',
          counts.warning ? `<span class="chip-stat warn">${counts.warning} warning${counts.warning === 1 ? '' : 's'}</span>` : '',
          counts.info ? `<span class="chip-stat">${counts.info} info</span>` : '',
          `<span class="chip-stat">${text.length.toLocaleString()} code units scanned</span>`,
        ].join('');

  if (lampOn) {
    revealedEl.innerHTML = renderRevealedHtml(text, findings);
  } else {
    revealedEl.innerHTML = text.length ? escapeHtml(text) : '<span class="empty">(empty)</span>';
  }

  const decoded = findings.filter((f) => f.decoded !== undefined);
  renderFindingsList(decodedEl, decoded, 'No smuggled payloads decoded.');

  const confusables = findings.filter((f) => f.rule === 'confusable');
  renderFindingsList(confusablesEl, confusables, 'No confusable identifiers found.');

  renderFindingsList(allFindingsEl, findings, 'No findings -- this text looks clean.');

  bidiRenderedEl.textContent = text;
  bidiLogicalEl.innerHTML = text.length ? reveal(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!) : '(empty)';
}

lampBtn.addEventListener('click', () => {
  lampOn = !lampOn;
  lampBtn.dataset.on = String(lampOn);
  lampBtn.setAttribute('aria-pressed', String(lampOn));
  lampLabel.innerHTML = lampOn ? '<strong>UV lamp: on</strong> -- click to see the input as everyone else does' : '<strong>UV lamp: off</strong> -- click to reveal what\'s hiding';
  render();
});

input.addEventListener('input', scheduleRender);

copyBtn.addEventListener('click', async () => {
  const { text } = sanitize(input.value);
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.dataset.copied = 'true';
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.dataset.copied = 'false';
      copyBtn.textContent = 'Copy sanitized text';
    }, 1600);
  } catch {
    copyBtn.textContent = 'Copy failed -- select & copy manually';
  }
});

exampleSelect.addEventListener('change', () => {
  const idx = exampleSelect.value;
  if (idx === '') return;
  const item = gallery[Number(idx)];
  if (!item) return;
  input.value = item.text;
  exampleSelect.value = '';
  render();
});

galleryEl.innerHTML = gallery
  .map(
    (g, i) => `
    <button type="button" class="specimen" data-index="${i}">
      <span class="tag">${g.lang}</span>
      <div class="title">${g.title}</div>
      <div class="desc">${g.description}</div>
    </button>`,
  )
  .join('');

galleryEl.querySelectorAll<HTMLButtonElement>('.specimen').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.index);
    const item = gallery[idx];
    if (!item) return;
    input.value = item.text;
    render();
    document.getElementById('input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

input.value = DEFAULT_TEXT;
render();

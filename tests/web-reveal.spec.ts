import { describe, expect, it } from 'vitest';
import { scanText, reveal } from '../src/core/index.js';
import { renderRevealedHtml } from '../web/src/renderRevealed.js';

const encodeSelectors = (text: string): string => [...new TextEncoder().encode(text)].map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join('');

describe('revealed evidence', () => {
  it('exposes invisible controls nested inside a confusable identifier', () => {
    const text = 'p\u200d\u0430ypal';
    const findings = scanText(text).findings;
    expect(findings.some((f) => f.rule === 'confusable')).toBe(true);
    expect(findings.some((f) => f.rule === 'invisible')).toBe(true);
    const html = renderRevealedHtml(text, findings);
    expect(html).toContain('gc-confusable');
    expect(html).toContain('gc-chip');
    expect(html).not.toContain('\u200d');
  });

  it('does not reactivate bidi or invisible controls decoded from selectors', () => {
    const text = 'A' + encodeSelectors('hello\u202e\u200bworld');
    expect(reveal(text)).not.toContain('\u202e');
    expect(reveal(text)).not.toContain('\u200b');
    expect(reveal(text)).toContain('\\u{202E}');
    const html = renderRevealedHtml(text, scanText(text).findings);
    expect(html).not.toContain('\u202e');
    expect(html).not.toContain('\u200b');
  });

  it('uses the full overlapping selector finding rather than leaking its tail', () => {
    const text = '\u200b' + encodeSelectors('hidden');
    const html = renderRevealedHtml(text, scanText(text).findings);
    expect(html).not.toMatch(/[\u{E0100}-\u{E01EF}]/u);
    expect(reveal(text)).not.toMatch(/[\u{E0100}-\u{E01EF}]/u);
  });

  it('preserves astral characters and escapes text and diagnostic attributes', () => {
    const text = '🧪 <img src=x onerror="alert(1)"> p\u200d\u0430ypal';
    const html = renderRevealedHtml(text, scanText(text).findings);
    expect(html).toContain('🧪');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
});

import { describe, expect, it } from 'vitest';
import { reveal } from '../src/core/reveal.js';
import { sanitize } from '../src/core/sanitize.js';

describe('sanitize()', () => {
  it('removes bidi overrides and restores the plain text', () => {
    const text = 'ls ‮exe.txt‬.png';
    const { text: cleaned, fixed } = sanitize(text);
    expect(cleaned).toBe('ls exe.txt.png');
    expect(fixed.length).toBeGreaterThan(0);
  });

  it('leaves confusable findings alone (not auto-fixable)', () => {
    const mixed = 'pаypal';
    const { text: cleaned, remaining } = sanitize(mixed);
    expect(cleaned).toBe(mixed);
    expect(remaining.some((f) => f.rule === 'confusable')).toBe(true);
  });

  it('honors mode: "keep" as a dry run that changes nothing', () => {
    const text = 'a​b';
    const { text: cleaned } = sanitize(text, { mode: 'keep' });
    expect(cleaned).toBe(text);
  });

  it('respects a restricted rule list', () => {
    const text = 'a​b  c';
    const { text: cleaned } = sanitize(text, { rules: ['invisible'] });
    expect(cleaned).toBe('ab  c');
  });
});

describe('reveal()', () => {
  it('renders an RLO override as a labelled chip', () => {
    const out = reveal('a‮b');
    expect(out).toContain('⟦U+202E RLO⟧');
  });

  it('shows the decoded payload for a tag-smuggling run', () => {
    const hidden = '\u{E0068}\u{E0069}';
    const out = reveal(hidden);
    expect(out).toContain('→ "hi"');
  });

  it('passes ordinary text through unchanged', () => {
    expect(reveal('hello world')).toBe('hello world');
  });
});

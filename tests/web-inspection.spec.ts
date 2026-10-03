import { describe, expect, it } from 'vitest';
import { inspectText } from '../web/src/inspection.js';
import { MAX_DISPLAY_FINDINGS, MAX_INPUT_CODE_UNITS, MAX_PREVIEW_CODE_UNITS } from '../web/src/limits.js';
import { scanText } from '../src/core/index.js';

describe('browser inspection', () => {
  it('keeps full-input counts and output while bounding dense rendered evidence', () => {
    const text = 'a\u200b'.repeat(800);
    const result = inspectText(text);
    expect(result.totalFindings).toBe(scanText(text).findings.length);
    expect(result.totalFindings).toBeGreaterThan(MAX_DISPLAY_FINDINGS);
    expect(result.findings).toHaveLength(MAX_DISPLAY_FINDINGS);
    expect(result.previewUnits).toBeLessThan(text.length);
    expect(result.sanitized.text).toBe('a'.repeat(800));
    expect(result.sanitized.removedUnits).toBe(800);
    expect(result.sanitized.remainingCount).toBe(0);
  });

  it('reports unresolved lookalikes after removing fixable characters', () => {
    const result = inspectText('p\u0430ypal\u200b');
    expect(result.sanitized.text).toBe('p\u0430ypal');
    expect(result.sanitized.remainingCount).toBeGreaterThan(0);
    expect(result.sanitized.remaining.every((finding) => finding.rule === 'confusable')).toBe(true);
  });

  it('does not split a surrogate pair at the preview boundary', () => {
    const text = ' '.repeat(MAX_PREVIEW_CODE_UNITS - 1) + '🧪 end';
    const result = inspectText(text);
    expect(result.previewUnits).toBe(MAX_PREVIEW_CODE_UNITS - 1);
    expect(result.previewText).toBe(' '.repeat(MAX_PREVIEW_CODE_UNITS - 1));
    expect(result.sanitized.text).toBe(text);
  });

  it('labels omitted large findings without falsely calling the full input clean', () => {
    const text = 'p\u0430ypal'.repeat(2000);
    const result = inspectText(text);
    expect(result.previewUnits).toBe(0);
    expect(result.totalFindings).toBeGreaterThan(0);
    expect(result.findings[0]!.message).toContain('[diagnostic shortened]');
    expect(result.sanitized.remainingCount).toBeGreaterThan(0);
  });

  it('accepts the exact input limit and rejects a code unit beyond it', () => {
    expect(inspectText(' '.repeat(MAX_INPUT_CODE_UNITS)).codePointCount).toBe(MAX_INPUT_CODE_UNITS);
    expect(() => inspectText(' '.repeat(MAX_INPUT_CODE_UNITS + 1))).toThrow(/100,000/);
  });

  it('escapes diagnostic controls without altering decoded source or offsets', () => {
    const source = '🧪 p\u200d\u0430ypal';
    const result = inspectText(source);
    const invisible = result.findings.find((finding) => finding.rule === 'invisible')!;
    expect(source.slice(invisible.start.offset, invisible.end.offset)).toBe('\u200d');
    expect(result.findings.every((finding) => !finding.message.includes('\u200d'))).toBe(true);
  });
});

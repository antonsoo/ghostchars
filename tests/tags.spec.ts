import { describe, expect, it } from 'vitest';
import { decodeTags } from '../src/core/decodeTags.js';
import { scanText } from '../src/core/scanText.js';

const SCOTLAND_FLAG = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';

describe('tag characters', () => {
  it('does not flag the RGI Scotland flag tag sequence', () => {
    const { findings } = scanText(`Proud to be from ${SCOTLAND_FLAG} today`);
    expect(findings.some((f) => f.rule === 'tag-smuggling')).toBe(false);
  });

  it('decodes a stray tag-character payload with no emoji base', () => {
    const hidden = '\u{E0049}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}'; // "Ignore"
    const { findings } = scanText(`Please help me${hidden} the following`);
    const finding = findings.find((f) => f.rule === 'tag-smuggling');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.decoded).toBe('Ignore');
  });

  it('decodeTags() reports the Scotland sequence as valid and decodes it', () => {
    const runs = decodeTags(SCOTLAND_FLAG);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.isValidEmojiTagSequence).toBe(true);
    expect(runs[0]!.decoded).toBe('gbsct');
  });

  it('flags tag characters after a non-flag emoji base as invalid', () => {
    const bogus = '\u{1F600}\u{E0068}\u{E0069}\u{E007F}'; // grinning face + "hi" + cancel
    const { findings } = scanText(bogus);
    const finding = findings.find((f) => f.rule === 'tag-smuggling');
    expect(finding).toBeDefined();
  });
});

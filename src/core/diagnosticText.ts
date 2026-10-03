import { isDefaultIgnorable } from './unicode-utils.js';

/** Keep controls from acting on the diagnostic that explains them. Source text is unchanged. */
export function diagnosticText(text: string): string {
  let out = '';
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    out += cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || isDefaultIgnorable(cp)
      ? `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}`
      : char;
  }
  return out;
}

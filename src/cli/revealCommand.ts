import { readFileSync } from 'node:fs';
import { reveal, scanText } from '../core/index.js';
import { diagnosticText } from '../core/diagnosticText.js';
import { colors } from './colors.js';
import { decodeFile } from './encoding.js';

export function revealCommand(target: string | undefined): number {
  if (!target) {
    console.error(colors.red('Usage: ghostchars reveal <file|->'));
    return 2;
  }

  let text: string;
  try {
    text = decodeFile(readFileSync(target === '-' ? 0 : target)).text;
  } catch (err) {
    console.error(colors.red(diagnosticText(`Could not read ${target === '-' ? 'stdin' : target}: ${(err as Error).message}`)));
    return 2;
  }

  // Keep ordinary line breaks, while controls and bidi marks cannot act on the
  // terminal. Reveal still runs on the whole input so payload context is intact.
  console.log(reveal(text).split(/\r\n|\r|\n/).map(diagnosticText).join('\n'));

  const { findings } = scanText(text);
  const decoded = findings.filter((f) => f.decoded);
  if (decoded.length > 0) {
    console.log('\n' + colors.bold('Decoded payloads:'));
    for (const f of decoded) {
      console.log(`  ${colors.gray(`${f.start.line}:${f.start.column}`)} ${colors.dim(f.rule)} -> ${diagnosticText(JSON.stringify(f.decoded))}`);
    }
  }

  return 0;
}

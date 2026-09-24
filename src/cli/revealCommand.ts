import { readFileSync } from 'node:fs';
import { reveal, scanText } from '../core/index.js';
import { colors } from './colors.js';

export function revealCommand(target: string | undefined): number {
  if (!target) {
    console.error(colors.red('Usage: ghostchars reveal <file|->'));
    return 2;
  }

  let text: string;
  try {
    text = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
  } catch (err) {
    console.error(colors.red(`Could not read ${target === '-' ? 'stdin' : target}: ${(err as Error).message}`));
    return 2;
  }

  console.log(reveal(text));

  const { findings } = scanText(text);
  const decoded = findings.filter((f) => f.decoded);
  if (decoded.length > 0) {
    console.log('\n' + colors.bold('Decoded payloads:'));
    for (const f of decoded) {
      console.log(`  ${colors.gray(`${f.start.line}:${f.start.column}`)} ${colors.dim(f.rule)} -> ${JSON.stringify(f.decoded)}`);
    }
  }

  return 0;
}

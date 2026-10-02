#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../core/index.js';
import type { ScanOptions } from '../core/index.js';
import { loadConfig, scanOptionsForFile } from './config.js';
import { decodeFile, encodeFile, type FileEncoding } from './encoding.js';
import { formatGithub } from './formatters/github.js';
import { formatJson } from './formatters/json.js';
import { formatPretty } from './formatters/pretty.js';
import { formatSarif } from './formatters/sarif.js';
import { computeFix, formatDryRun } from './fix.js';
import { revealCommand } from './revealCommand.js';
import type { ScanReport } from './report.js';
import { severityCounts } from './report.js';
import { colors } from './colors.js';
import { discoverFiles } from './walk.js';
import { VERSION } from './version.js';


const HELP = `ghostchars ${VERSION} -- catch invisible and deceptive Unicode

Usage:
  ghostchars [paths...]              Scan files (defaults to ".")
  ghostchars reveal <file|->         Print text with invisible characters shown
  ghostchars --help | --version

Options:
  --format <pretty|json|sarif|github>  Output format (default: pretty)
  --fix                                 Remove fixable findings in place
  --dry-run                             With --fix, preview changes instead of writing
  --config <path>                       Path to a .ghostcharsrc.json (default: ./.ghostcharsrc.json)
  --no-config                           Ignore any .ghostcharsrc.json
  --quiet                               Suppress the summary line

Exit codes: 0 = no error-level findings, 1 = error-level findings present, 2 = usage/runtime error.
`;

function parseArgs(argv: string[]) {
  const args = { format: 'pretty', fix: false, dryRun: false, config: undefined as string | undefined, noConfig: false, quiet: false, help: false, version: false, paths: [] as string[], command: 'scan' as 'scan' | 'reveal' };
  let i = 0;
  if (argv[0] === 'reveal') {
    args.command = 'reveal';
    i = 1;
  }
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--fix') args.fix = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--no-config') args.noConfig = true;
    else if (a === '--format') args.format = argv[++i] ?? 'pretty';
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a === '--config') args.config = argv[++i];
    else if (a.startsWith('--config=')) args.config = a.slice('--config='.length);
    else if (a !== '-' && a.startsWith('-')) throw new UsageError(`Unknown option: ${a}`);
    else args.paths.push(a);
  }
  return args;
}

class UsageError extends Error {}

export function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(colors.red(String((err as Error).message)));
    console.error(HELP);
    return 2;
  }

  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.version) {
    console.log(VERSION);
    return 0;
  }

  if (args.command === 'reveal') {
    return revealCommand(args.paths[0]);
  }

  const cwd = process.cwd();
  let config;
  try {
    config = args.noConfig ? {} : loadConfig(cwd, args.config);
  } catch (err) {
    console.error(colors.red((err as Error).message));
    return 2;
  }
  // A path named on the command line that isn't there is a mistake in the command (a typo in
  // a CI step), not a file to skip: "no findings in 0 files" and exit 0 would pass the check
  // without having scanned anything.
  const missing = args.paths.filter((path) => !existsSync(resolve(cwd, path)));
  if (missing.length > 0) {
    console.error(colors.red(`ghostchars: no such file or directory: ${missing.join(', ')}`));
    return 2;
  }
  const start = performance.now();
  const { files, skipped } = discoverFiles(args.paths, cwd);

  const report: ScanReport = { files: [], skipped, durationMs: 0 };
  let hadFixes = false;

  for (const file of files) {
    let source: string;
    let encoding: FileEncoding;
    try {
      ({ text: source, encoding } = decodeFile(readFileSync(file.absPath)));
    } catch (err) {
      report.skipped.push({ path: file.path, reason: `read error: ${(err as Error).message}` });
      continue;
    }

    const options: ScanOptions = scanOptionsForFile(config, file.path);
    const { findings } = scanText(source, options);
    report.files.push({ path: file.path, source, findings });

    if (args.fix && findings.some((f) => f.fixable)) {
      const outcome = computeFix(file.path, source);
      if (outcome.fixed.length > 0) {
        hadFixes = true;
        if (args.dryRun) {
          const preview = formatDryRun(outcome, source);
          if (preview) console.log(preview + '\n');
        } else {
          writeFileSync(file.absPath, encodeFile(outcome.newText, encoding));
        }
      }
    }
  }

  report.durationMs = performance.now() - start;

  if (!(args.fix && args.dryRun)) {
    const output = args.format === 'json' ? formatJson(report) : args.format === 'sarif' ? formatSarif(report) : args.format === 'github' ? formatGithub(report) : formatPretty(report);
    console.log(output);
  } else if (!hadFixes && !args.quiet) {
    console.log(colors.green('ghostchars: nothing to fix.'));
  }

  const counts = severityCounts(report);
  if (counts.error > 0) return 1;
  return 0;
}

// npx, `npm i -g` and node_modules/.bin all launch the CLI through a symlink, so
// compare resolved real paths rather than the raw argv[1] string.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // Not process.exit(): a report written to a pipe (a CI log, `| jq`) is still on its way out
  // when main() returns, and exiting at once cut everything past the pipe's 64 KB buffer.
  process.exitCode = main(process.argv.slice(2));
}

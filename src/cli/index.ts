#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { scanText } from '../core/index.js';
import { diagnosticText } from '../core/diagnosticText.js';
import type { ScanOptions } from '../core/index.js';
import { loadConfig, scanOptionsForFile } from './config.js';
import { decodeFile, encodeFile, type FileEncoding } from './encoding.js';
import { formatGithub } from './formatters/github.js';
import { formatJson } from './formatters/json.js';
import { formatPretty } from './formatters/pretty.js';
import { formatSarif } from './formatters/sarif.js';
import { formatSummary } from './formatters/summary.js';
import { computeFix, formatDryRun } from './fix.js';
import { revealCommand } from './revealCommand.js';
import type { ScanReport } from './report.js';
import { severityCounts } from './report.js';
import { colors } from './colors.js';
import { discoverFiles, throughSymlink } from './walk.js';
import { VERSION } from './version.js';
import { replaceFiles, type RepairPlan } from './replaceFiles.js';
import { prepareReportOutput } from './writeReport.js';


const HELP = `ghostchars ${VERSION} -- catch invisible and deceptive Unicode

Usage:
  ghostchars [paths...]              Scan files (defaults to ".")
  ghostchars reveal <file|->         Print text with invisible characters shown
  ghostchars --help | --version

Options:
  --format <pretty|summary|json|sarif|github>  Output format (default: pretty; summary is one line per kind of finding in a file)
  --fix                                 Remove fixable findings in place
  --dry-run                             With --fix, preview changes instead of writing
  --config <path>                       Path to a .ghostcharsrc.json (default: ./.ghostcharsrc.json)
  --no-config                           Ignore any .ghostcharsrc.json
  --output <path>                       Write the scan report to a separate file after scanning
  --quiet                               Suppress the summary line

Exit codes: 0 = no error-level findings, 1 = error-level findings present, 2 = usage/runtime error.
`;

function parseArgs(argv: string[]) {
  const args = { format: 'pretty', fix: false, dryRun: false, config: undefined as string | undefined, output: undefined as string | undefined, noConfig: false, quiet: false, help: false, version: false, paths: [] as string[], command: 'scan' as 'scan' | 'reveal' };
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
    else if (a === '--config') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError('--config requires a file path');
      args.config = value;
    }
    else if (a.startsWith('--config=')) args.config = a.slice('--config='.length);
    else if (a === '--output') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new UsageError('--output requires a file path');
      args.output = value;
    }
    else if (a.startsWith('--output=')) args.output = a.slice('--output='.length);
    else if (a !== '-' && a.startsWith('-')) throw new UsageError(`Unknown option: ${a}`);
    else args.paths.push(a);
  }
  if (args.config === '') throw new UsageError('--config requires a file path');
  if (args.output === '') throw new UsageError('--output requires a file path');
  if (args.output && args.command === 'reveal') throw new UsageError('--output is for scan reports; reveal writes to stdout');
  return args;
}

class UsageError extends Error {}

export function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(colors.red(diagnosticText(String((err as Error).message))));
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
    console.error(colors.red(diagnosticText((err as Error).message)));
    return 2;
  }
  const start = performance.now();
  const { files, skipped, errors } = discoverFiles(args.paths, cwd);

  let writeOutput: ((text: string) => void) | undefined;
  if (args.output) {
    try {
      writeOutput = prepareReportOutput(args.output, [
        ...args.paths.map(path => resolve(cwd, path)),
        ...files.map(file => file.absPath),
        ...skipped.map(file => resolve(cwd, file.path)),
        ...errors.map(file => resolve(cwd, file.path)),
        ...(!args.noConfig ? [resolve(cwd, args.config ?? '.ghostcharsrc.json')] : []),
      ]);
    } catch (error) {
      console.error(diagnosticText(`ghostchars: could not prepare report output: ${(error as Error).message}`));
      return 2;
    }
  }
  const outputLines: string[] = [];
  const print = (text: string): void => {
    if (writeOutput) outputLines.push(text + '\n');
    else console.log(text);
  };

  const report: ScanReport = { files: [], skipped, errors, durationMs: 0 };
  let hadFixes = false;
  const repairs: RepairPlan[] = [];

  for (const file of files) {
    let source: string;
    let encoding: FileEncoding;
    let original: Buffer;
    try {
      if (throughSymlink(file.absPath)) throw new Error('path became a symbolic link after discovery');
      original = readFileSync(file.absPath);
      ({ text: source, encoding } = decodeFile(original));
    } catch (err) {
      report.errors.push({ path: file.path, reason: `read error: ${(err as Error).message}` });
      continue;
    }

    const options: ScanOptions = scanOptionsForFile(config, file.path);
    const { findings } = scanText(source, options);
    report.files.push({ path: file.path, source, findings });

    if (args.fix && findings.some((f) => f.fixable)) {
      const outcome = computeFix(file.path, source, options);
      if (outcome.fixed.length > 0) {
        hadFixes = true;
        if (args.dryRun) {
          const preview = formatDryRun(outcome, source);
          if (preview) print(preview + '\n');
        } else {
          repairs.push({ ...file, original, replacement: encodeFile(outcome.newText, encoding) });
        }
      }
    }
  }

  // Finish discovering and reading every input before changing any file. A
  // partial scan cannot establish which repairs the invocation should perform.
  if (repairs.length > 0 && report.errors.length > 0) {
    console.error('ghostchars: scan incomplete; no files were repaired.');
  } else {
    const replacement = replaceFiles(repairs);
    report.errors.push(...replacement.errors);
    if (replacement.errors.length) {
      console.error(replacement.repaired === 0
        ? 'ghostchars: repair failed; review the reported paths before retrying.'
        : `ghostchars: repair stopped after ${replacement.repaired} successful replacement(s); review the reported paths before retrying.`);
    }
  }

  report.durationMs = performance.now() - start;

  if (!(args.fix && args.dryRun)) {
    const output = args.format === 'json' ? formatJson(report) : args.format === 'sarif' ? formatSarif(report) : args.format === 'github' ? formatGithub(report) : args.format === 'summary' ? formatSummary(report) : formatPretty(report);
    print(output);
  } else if (!hadFixes && !args.quiet) {
    if (report.errors.length) print('ghostchars: scan incomplete; no fix preview is available for failed inputs.');
    else if (report.files.some((file) => file.findings.length > 0)) {
      print('ghostchars: no automatic removals under the current policy. Review the remaining findings.\n\n' + formatSummary(report));
    } else print(colors.green('ghostchars: nothing to fix.'));
  }

  if (args.fix && args.dryRun) {
    if (report.errors.length) console.error('ghostchars: preview incomplete; failed inputs have no repair plan.');
    for (const skip of report.skipped) console.error(diagnosticText(`skipped ${skip.path}: ${skip.reason}`));
    for (const error of report.errors) console.error(diagnosticText(`error ${error.path}: ${error.reason}`));
  }

  const counts = severityCounts(report);
  if (writeOutput) {
    try { writeOutput(outputLines.join('')); }
    catch (error) {
      console.error(diagnosticText(`ghostchars: could not write report output: ${(error as Error).message}`));
      return 2;
    }
  }
  if (report.errors.length) return 2;
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

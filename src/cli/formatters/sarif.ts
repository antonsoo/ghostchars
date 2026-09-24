import type { RuleId, Severity } from '../../core/index.js';
import type { ScanReport } from '../report.js';

const SARIF_LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  'bidi-control': 'Explicit bidirectional formatting character (Trojan Source, CVE-2021-42574).',
  'bidi-mark': 'Bidirectional mark character.',
  'bidi-unbalanced': 'Unbalanced or unterminated bidirectional embedding/isolate.',
  'tag-smuggling': 'Unicode tag characters outside a valid emoji tag sequence (ASCII smuggling).',
  'variation-selector-smuggling': 'Variation selector run decodes to a hidden payload.',
  'variation-selector-stray': 'Variation selector with no valid base character.',
  invisible: 'Invisible / default-ignorable character.',
  confusable: 'Visually confusable identifier (mixed script or skeleton collision).',
  'unusual-whitespace': 'Unusual whitespace character.',
  'control-character': 'Unexpected control character.',
};

export function formatSarif(report: ScanReport): string {
  const rules = Object.entries(RULE_DESCRIPTIONS).map(([id, description]) => ({
    id,
    shortDescription: { text: description },
    helpUri: 'https://github.com/antonsoo/ghostchars#detections',
  }));

  const results = report.files.flatMap((file) =>
    file.findings.map((f) => ({
      ruleId: f.rule,
      level: SARIF_LEVEL[f.severity],
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: file.path },
            region: {
              startLine: f.start.line,
              startColumn: f.start.column,
              endLine: f.end.line,
              endColumn: f.end.column,
            },
          },
        },
      ],
    })),
  );

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ghostchars',
            informationUri: 'https://github.com/antonsoo/ghostchars',
            version: '0.1.0',
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

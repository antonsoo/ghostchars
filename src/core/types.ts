/** Stable identifier for a detection rule. Used in config overrides and output. */
export type RuleId =
  | 'bidi-control'
  | 'bidi-mark'
  | 'bidi-unbalanced'
  | 'tag-smuggling'
  | 'variation-selector-smuggling'
  | 'variation-selector-stray'
  | 'invisible'
  | 'confusable'
  | 'unusual-whitespace'
  | 'control-character';

export type Severity = 'error' | 'warning' | 'info';

export interface Position {
  /** 1-based line number. */
  line: number;
  /** 1-based column number, counted in UTF-16 code units (matches most editors). */
  column: number;
  /** 0-based UTF-16 code unit offset from the start of the text. */
  offset: number;
}

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** Start of the offending span. */
  start: Position;
  /** End of the offending span (exclusive). */
  end: Position;
  /** The exact source file path, if scanning files; undefined for scanText() on a bare string. */
  file?: string;
  /** The code point(s) involved, as an array of Unicode scalar values. */
  codePoints: number[];
  /** Human-readable Unicode name(s) for the code point(s), e.g. "RIGHT-TO-LEFT OVERRIDE". */
  names: string[];
  /** One-sentence explanation of why this was flagged. */
  message: string;
  /** Suggested fix, in prose. */
  suggestion: string;
  /** Machine-readable decoded payload, when the finding is a smuggling rule (tags, variation selectors). */
  decoded?: string;
  /** For confusables: the skeleton string this identifier/span is confusable with. */
  skeleton?: string;
  /** True if `sanitize()` knows how to safely auto-fix this finding. */
  fixable: boolean;
}

export interface ScanOptions {
  /** File path to attach to findings and to match against config globs. Defaults to undefined (bare text). */
  file?: string;
  /** Per-rule severity overrides (e.g. downgrade a rule to 'info' or disable with false). */
  severityOverrides?: Partial<Record<RuleId, Severity | false>>;
  /** Code points to never flag, anywhere. */
  allowCodePoints?: Iterable<number>;
  /** Treat this scan as "code" (identifiers matter, stricter bidi/invisible defaults) vs free text. Default true. */
  isCode?: boolean;
}

export interface ScanResult {
  findings: Finding[];
  /** Total code points scanned. */
  codePointCount: number;
}

export type FixPolicyMode = 'remove' | 'keep';

export interface SanitizePolicy {
  /** Which rules to act on; defaults to every rule that is safely fixable. */
  rules?: RuleId[];
  /** 'remove' deletes the offending code points; 'keep' leaves them (dry inspection). Default 'remove'. */
  mode?: FixPolicyMode;
}

export interface SanitizeResult {
  text: string;
  /** Findings that were fixed. */
  fixed: Finding[];
  /** Findings that were left alone (not in policy, or not fixable). */
  remaining: Finding[];
}

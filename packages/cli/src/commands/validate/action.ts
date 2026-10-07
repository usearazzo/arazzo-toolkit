import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver-types';

import { loadConfig } from '../../config.ts';
import { formatters, defaultFormat } from './formatters/index.ts';
import writeReport, { wouldOverwriteInput } from './output.ts';

export interface ValidateActionOptions {
  format?: string;
  json?: boolean;
  output?: string;
  jsonSchemaValidation?: boolean;
  maxProblems?: number;
  failSeverity?: string;
  config?: string;
}

// --fail-severity choices, mapped to their LSP severity. Error is the most
// severe (smallest numeric value).
const failSeverities: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

export const failSeverityChoices = Object.keys(failSeverities);

export const defaultFailSeverity = 'error';

// a diagnostic fails the run when its severity is at least as severe as the
// --fail-severity threshold (Error is most severe = smallest numeric value)
const isFailure = (diagnostic: Diagnostic, threshold: DiagnosticSeverity): boolean =>
  diagnostic.severity !== undefined && diagnostic.severity <= threshold;

// LSP leaves an absent severity to the client; treat it as an error everywhere
// (exit code, sort order, formatters) rather than in some places only
const withSeverity = (diagnostic: Diagnostic): Diagnostic =>
  diagnostic.severity === undefined
    ? { ...diagnostic, severity: DiagnosticSeverity.Error }
    : diagnostic;

// the local filesystem path of the input, or undefined for an http(s) URL
const toInputPath = (source: string): string | undefined => {
  if (/^https?:/i.test(source)) {
    return undefined;
  }
  return /^file:/i.test(source) ? fileURLToPath(source) : path.resolve(source);
};

// the root reason of a read failure (ENOENT, HTTP 404, ...) sits several `cause`
// levels below ValidateError, so the whole chain is walked; a message already
// contained in the text so far is skipped
const errorMessage = (error: unknown): string => {
  let message = error instanceof Error ? error.message : String(error);
  let cause = error instanceof Error ? error.cause : undefined;
  while (cause instanceof Error) {
    if (!message.includes(cause.message)) {
      message = `${message}: ${cause.message}`;
    }
    cause = cause.cause;
  }
  return message;
};

const action = async (source: string, opts: ValidateActionOptions): Promise<void> => {
  try {
    // refuse to overwrite the input document with the diagnostics report - that
    // would silently destroy the user's Arazzo document. wouldOverwriteInput
    // compares filesystem identity to catch symlink/hardlink/case-insensitive
    // aliases, not only equal path strings.
    const inputPath = toInputPath(source);
    if (opts.output && inputPath !== undefined && wouldOverwriteInput(opts.output, inputPath)) {
      process.stderr.write('Error: --output path must differ from the input file\n');
      process.exitCode = 1;
      return;
    }

    // precedence: validator defaults < configuration file < command-line flags. A flag
    // only overrides when given, so an absent --json-schema-validation keeps the
    // configuration file's choice.
    const languageService = loadConfig(opts.config).languageService ?? {};
    const context = opts.jsonSchemaValidation
      ? {
          ...languageService,
          validationContext: { ...languageService.validationContext, jsonSchemaValidation: true },
        }
      : languageService;

    // the validator pulls in the language service, a heavy (~seconds) import, so it
    // is loaded lazily rather than at module top level - otherwise `--help` and
    // `--version` would pay the cost too
    const { validateURI } = await import('@usearazzo/validator');
    const diagnostics = (await validateURI(source, context)).map(withSeverity);

    const threshold = failSeverities[opts.failSeverity ?? defaultFailSeverity];
    const failed = diagnostics.some((diagnostic) => isFailure(diagnostic, threshold));

    // sort once, then cap once, so the JSON and human outputs report the same
    // diagnostics in the same (line:column:severity) order. The exit code above
    // is computed from the full set, so --max-problems never masks a failure.
    const sorted = [...diagnostics].sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character ||
        (a.severity ?? DiagnosticSeverity.Error) - (b.severity ?? DiagnosticSeverity.Error),
    );
    const reported =
      typeof opts.maxProblems === 'number' && opts.maxProblems > 0
        ? sorted.slice(0, opts.maxProblems)
        : sorted;

    // --json is shorthand for --format json and wins if both are given
    const format = opts.json ? 'json' : (opts.format ?? defaultFormat);
    const formatter = formatters[format] ?? formatters[defaultFormat];
    const rendered = `${formatter(reported, { path: source, total: diagnostics.length })}\n`;
    writeReport(rendered, format, opts.output);

    // set the exit code and let the process exit naturally. Calling process.exit()
    // here would terminate before an async (piped) stdout write drains, truncating
    // large output at the ~64KB pipe buffer.
    process.exitCode = failed ? 1 : 0;
  } catch (error: unknown) {
    process.stderr.write(`Error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
};

export default action;

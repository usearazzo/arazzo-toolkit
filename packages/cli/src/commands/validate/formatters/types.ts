import type { Diagnostic } from 'vscode-languageserver-types';

export interface FormatterContext {
  // display path echoed in the output — the user-supplied path, verbatim
  path: string;
  // total number of diagnostics BEFORE the --max-problems cap, so a formatter
  // can note when it is only showing a subset. The `diagnostics` it receives
  // are already sorted and capped.
  total: number;
}

// a formatter renders the (already sorted and capped) diagnostics into the
// string written to stdout. It never decides the exit code — the action does.
export type Formatter = (diagnostics: Diagnostic[], context: FormatterContext) => string;

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Diagnostic } from 'vscode-languageserver-types';
import { mediaTypes } from '@speclynx/apidom-ns-arazzo-1';
import {
  getLanguageService,
  findNamespace,
  ApilintCodes,
  LogLevel,
  type LanguageServiceContext,
} from '@speclynx/apidom-ls';
import type { PartialDeep } from 'type-fest';
import { mergeDeepRight } from 'ramda';

import { Arazzo1JsonSchemaValidationProvider } from './json-schema-provider.ts';

/**
 * Default language service context for validation.
 *
 * Controls validation behavior: semantic validation, reference validation and
 * semantic linting are enabled, JSON Schema validation is opt-in.
 *
 * @public
 */
export const defaultLanguageServiceContext: Partial<LanguageServiceContext> = {
  logLevel: LogLevel.NONE,
  defaultContentLanguage: {
    namespace: 'arazzo',
    version: '1.0.1',
    mediaType: mediaTypes.findBy('1.0.1'),
  },
  validatorProviders: [new Arazzo1JsonSchemaValidationProvider()],
  // semantic validation, reference validation and semantic linting are always
  // on, while JSON Schema (AJV) validation is opt-in. `betterAjvErrors` is kept
  // on so opting in also gets the friendlier AJV messages.
  validationContext: {
    jsonSchemaValidation: false,
    semanticValidation: true,
    referenceValidation: true,
    semanticLinting: true,
    betterAjvErrors: true,
  },
  parseContext: {
    fileAllowList: ['*'],
    arazzo: {
      sourceDescriptionsResolution: true,
    },
  },
};

/**
 * Validates an Arazzo Document from a TextDocument.
 *
 * This is a lower-level API for advanced use cases such as IDE integrations
 * or when you already have document content in memory.
 *
 * @param textDocument - The TextDocument containing the Arazzo Document content
 * @param context - Optional language service context override (deep merged with defaults)
 * @returns Promise resolving to an array of Diagnostic objects
 *
 * @example
 * Basic usage
 * ```typescript
 * import { validate, TextDocument, DiagnosticSeverity, ARAZZO_LANGUAGE_ID, DEFAULT_DOCUMENT_VERSION } from '@usearazzo/validator';
 *
 * const textDocument = TextDocument.create(
 *   'file:///path/to/arazzo.yaml',
 *   ARAZZO_LANGUAGE_ID,
 *   DEFAULT_DOCUMENT_VERSION,
 *   content
 * );
 * const diagnostics = await validate(textDocument);
 * const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
 * ```
 *
 * @example
 * Enable JSON Schema validation (opt-in)
 * ```typescript
 * const diagnostics = await validate(textDocument, {
 *   validationContext: { jsonSchemaValidation: true }
 * });
 * ```
 * @public
 */
export async function validate(
  textDocument: TextDocument,
  context: PartialDeep<LanguageServiceContext> = {},
): Promise<Diagnostic[]> {
  const content = textDocument.getText();
  // classify with the language service's own detector so the two cannot diverge.
  // `defaultContentLanguage` is deliberately not passed - it would make arrays,
  // empty files and plain objects fall back to Arazzo.
  const { namespace } = await findNamespace(content);

  if (namespace !== 'arazzo') {
    const lastChar = textDocument.positionAt(content.length);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastChar.line, character: lastChar.character },
        },
        message: 'Document content is not recognized as an Arazzo Specification',
        severity: DiagnosticSeverity.Error,
        code: ApilintCodes.ARAZZO_NOT_DETECTED,
        source: 'apilint',
      },
    ];
  }

  const mergedContext = mergeDeepRight(
    defaultLanguageServiceContext,
    context,
  ) as LanguageServiceContext;
  const languageService = getLanguageService(mergedContext);

  try {
    return await languageService.doValidation(textDocument);
  } finally {
    languageService.terminate();
  }
}

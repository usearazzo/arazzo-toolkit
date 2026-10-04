import type { Diagnostic } from 'vscode-languageserver-types';
import {
  Arazzo1JsonSchemaValidationProvider as BaseArazzo1JsonSchemaValidationProvider,
  Arazzo11JsonSchemaValidationProvider as BaseArazzo11JsonSchemaValidationProvider,
  type ValidationContext,
} from '@speclynx/api-languageservice';

/**
 * Custom JSON Schema validation provider that assigns proper diagnostic codes.
 *
 * Extends the base Arazzo1JsonSchemaValidationProvider to set 'json-schema'
 * as the code for all diagnostics, making them identifiable in CLI output.
 * Covers Arazzo 1.0.x documents.
 *
 * @internal
 */
export class Arazzo1JsonSchemaValidationProvider extends BaseArazzo1JsonSchemaValidationProvider {
  public override validate(
    jsonDocument: string,
    originalDocument: string,
    isYaml: boolean,
    diagnostics: Diagnostic[],
    validationContext?: ValidationContext,
  ): void {
    const startIndex = diagnostics.length;
    super.validate(jsonDocument, originalDocument, isYaml, diagnostics, validationContext);

    // assign 'json-schema' code only to diagnostics added by this provider
    for (let i = startIndex; i < diagnostics.length; i++) {
      diagnostics[i].code = 'json-schema';
    }
  }
}

/**
 * The Arazzo 1.1.0 counterpart of {@link Arazzo1JsonSchemaValidationProvider}.
 *
 * The two upstream providers share no base that carries the Arazzo schema, so
 * the 'json-schema' code assignment is repeated here rather than inherited.
 *
 * @internal
 */
export class Arazzo11JsonSchemaValidationProvider extends BaseArazzo11JsonSchemaValidationProvider {
  public override validate(
    jsonDocument: string,
    originalDocument: string,
    isYaml: boolean,
    diagnostics: Diagnostic[],
    validationContext?: ValidationContext,
  ): void {
    const startIndex = diagnostics.length;
    super.validate(jsonDocument, originalDocument, isYaml, diagnostics, validationContext);

    // assign 'json-schema' code only to diagnostics added by this provider
    for (let i = startIndex; i < diagnostics.length; i++) {
      diagnostics[i].code = 'json-schema';
    }
  }
}

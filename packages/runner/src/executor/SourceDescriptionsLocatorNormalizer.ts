import { parse as parseRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';

import type DocumentRegistry from '../registry/DocumentRegistry.ts';

/**
 * Base of the locator normalizers that resolve
 * `$sourceDescriptions.{name}.{reference}` runtime expressions — the OpenAPI
 * operation locator and the Arazzo workflow locator. Owns the registry handle
 * and the one grammar-facing parse, so the expression node's name and field
 * shape are encoded once rather than per subclass.
 * @internal
 */
abstract class SourceDescriptionsLocatorNormalizer {
  protected readonly registry: DocumentRegistry;

  constructor(registry: DocumentRegistry) {
    this.registry = registry;
  }

  /**
   * Parses a `$sourceDescriptions.{name}.{reference}` expression, or returns
   * `undefined` when the string is not one (whether it fails to parse or
   * parses to another expression kind) — each subclass raises its own error
   * type, message, and context for its own position.
   */
  protected parseSourceDescriptionsExpression(
    expression: string,
  ): { sourceName: string; reference: string } | undefined {
    const { result, tree } = parseRuntimeExpression(expression);
    if (!result.success || tree.type !== 'SourceDescriptionsExpression') return undefined;

    const { sourceName, reference } = tree;
    return { sourceName, reference };
  }
}

export default SourceDescriptionsLocatorNormalizer;

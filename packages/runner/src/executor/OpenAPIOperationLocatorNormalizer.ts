import { extract, test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import { URIFragmentIdentifier, testJSONPointer } from '@swaggerexpert/json-pointer';
import { url } from '@speclynx/apidom-reference/configuration/empty';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import OpenAPIDocument from '../document/OpenAPIDocument.ts';
import RuntimeExpressionEvaluator from '../expression/RuntimeExpressionEvaluator.ts';
import OpenAPIOperationExtractor from '../extractor/OpenAPIOperationExtractor.ts';
import ExecutionError from '../errors/ExecutionError.ts';
import type { StepScope } from '../resolver/ResolverScope.ts';
import SourceDescriptionsLocatorNormalizer from './SourceDescriptionsLocatorNormalizer.ts';

/**
 * A canonical OpenAPI operation locator: the OpenAPI document that owns the
 * operation and a JSON Pointer locating the operation within it
 * (`/paths/{path}/{method}`).
 *
 * A step names its operation in one of several ways — a plain `operationId`, a
 * `$sourceDescriptions` runtime expression, or an `operationPath` — which are
 * all locators for the same thing. The normalizer reduces any of them to this
 * single canonical form.
 * @public
 */
export interface OpenAPIOperationLocator {
  readonly document: OpenAPIDocument;
  readonly jsonPointer: string;
  /**
   * The source description the step reached the operation through. Absent when
   * the reference names none (an `operationPath` with a literal URL) and on a
   * locator built by hand.
   */
  readonly sourceDescription?: OpenAPIOperationSourceDescription;
}

/**
 * A source description as an Arazzo document declares it: its `name`, and the
 * URI of the Arazzo document that declares it. Names are local to their
 * document, so the pair identifies one source description across a run.
 * @public
 */
export interface OpenAPIOperationSourceDescription {
  readonly name: string;
  readonly documentURI: string;
}

/**
 * Normalizes a step's OpenAPI operation locator to a canonical
 * {@link OpenAPIOperationLocator} — the OpenAPI document and a JSON Pointer to
 * the operation within it.
 *
 * A step names its operation with either `operationId` or `operationPath`:
 * - `operationId` is a plain operation name, or a whole runtime expression
 *   `$sourceDescriptions.{name}.{operationId}`. Per the Arazzo Specification, a
 *   plain name is only valid when a single (non-arazzo) source description is
 *   defined; multiple sources require the expression form. A plain name is
 *   therefore looked up in the first OpenAPI source description only.
 * - `operationPath` embeds a `{$sourceDescriptions.{name}.url}` runtime
 *   expression followed by a JSON Pointer to the operation.
 *
 * The `type` declared on a source description is not trusted (it may be absent
 * or wrong); a source is classified by what it actually parses to. The
 * normalizer acquires the referenced source documents from the registry on
 * demand.
 *
 * A reference that cannot be resolved throws {@link ExecutionError}, attributed
 * to the referencing step when a {@link StepScope} is given:
 * `operation-not-found` when no operation answers it,
 * `source-description-not-found` for a source name the document does not
 * define, `source-description-not-openapi` for a source that is not an OpenAPI
 * document, and `invalid-operation-reference` for a reference malformed as
 * written. Every returned locator names an existing operation.
 * @public
 */
class OpenAPIOperationLocatorNormalizer extends SourceDescriptionsLocatorNormalizer {
  readonly #extractor = new OpenAPIOperationExtractor();

  /**
   * Normalizes a plain or expression `operationId` to a canonical locator.
   *
   * A whole runtime expression (`$sourceDescriptions.{name}.{operationId}`) is
   * resolved against its named source; a plain name is looked up in the first
   * OpenAPI source description only.
   */
  async normalizeOperationId(
    operationId: string,
    document: ArazzoDocument,
    scope?: StepScope,
  ): Promise<OpenAPIOperationLocator> {
    if (isRuntimeExpression(operationId)) {
      return this.#resolveSourced(operationId, document, scope);
    }
    return this.#resolvePlainOperationId(operationId, document, scope);
  }

  /**
   * Normalizes an `operationPath` —
   * `{$sourceDescriptions.{name}.url}#/json/pointer` — to a canonical locator.
   *
   * The reference is interpolated (resolving
   * `{$sourceDescriptions.{name}.url}` to the source's URL) into a URI
   * reference; its fragment is the JSON Pointer to the operation (decoded from
   * the URI fragment representation) and the part before the fragment is the
   * source document to acquire.
   *
   * The runner only needs a URL and a JSON Pointer, so it does not enforce that
   * the source description is identified by a runtime expression rather than a
   * literal URL (a literal URL interpolates to itself and still resolves) — that
   * is a conformance concern for the validator. A source name the document does
   * not define is detected before interpolation, so it is reported as such
   * rather than as the empty URL it would interpolate to; the JSON Pointer must
   * locate an operation in the acquired OpenAPI document.
   */
  async normalizeOperationPath(
    operationPath: string,
    document: ArazzoDocument,
    scope?: StepScope,
  ): Promise<OpenAPIOperationLocator> {
    let sourceName: string | undefined;
    for (const expression of extract(operationPath) ?? []) {
      const parsed = this.parseSourceDescriptionsExpression(expression);
      // only the source whose url the path is built from names its document
      if (parsed?.reference === 'url') sourceName ??= parsed.sourceName;
      if (
        parsed !== undefined &&
        document.resolveSourceDescriptionURI(parsed.sourceName) === undefined
      ) {
        throw new ExecutionError(
          `operationPath "${operationPath}" names source description "${parsed.sourceName}", which the Arazzo document at "${document.uri}" does not define`,
          { ...scope, reason: ExecutionError.SourceDescriptionNotFound },
        );
      }
    }

    const evaluator = new RuntimeExpressionEvaluator(
      {},
      { strict: false, document, registry: this.registry },
    );
    const uriReference = evaluator.interpolate(operationPath);

    const documentURI = url.sanitize(url.stripHash(uriReference));
    if (documentURI === '') {
      throw new ExecutionError(
        `operationPath "${operationPath}" does not resolve to a source description URL`,
        { ...scope, reason: ExecutionError.InvalidOperationReference },
      );
    }

    const jsonPointer = URIFragmentIdentifier.fromURIReference(uriReference);
    if (!testJSONPointer(jsonPointer)) {
      throw new ExecutionError(`operationPath "${operationPath}" has an invalid JSON Pointer`, {
        ...scope,
        reason: ExecutionError.InvalidOperationReference,
      });
    }

    const source = await this.registry.acquire(documentURI);
    if (!OpenAPIDocument.is(source)) {
      throw new ExecutionError(
        `operationPath "${operationPath}" references "${documentURI}", which is not an OpenAPI document`,
        { ...scope, reason: ExecutionError.SourceDescriptionNotOpenAPI },
      );
    }

    // the extractor owns locating an operation by pointer; its failure here
    // means the pointer names no operation in this document.
    try {
      this.#extractor.extractByPointer(source, jsonPointer);
    } catch (error: unknown) {
      throw new ExecutionError(
        `operationPath "${operationPath}" does not locate an operation in the OpenAPI document at "${source.uri}"`,
        { cause: error, ...scope, reason: ExecutionError.OperationNotFound },
      );
    }

    return {
      document: source,
      jsonPointer,
      ...(sourceName === undefined
        ? {}
        : { sourceDescription: { name: sourceName, documentURI: document.uri } }),
    };
  }

  async #resolveSourced(
    expression: string,
    document: ArazzoDocument,
    scope: StepScope | undefined,
  ): Promise<OpenAPIOperationLocator> {
    const parsed = this.parseSourceDescriptionsExpression(expression);
    if (parsed === undefined) {
      throw new ExecutionError(
        `operationId "${expression}" is not a $sourceDescriptions.{name}.{operationId} expression`,
        { ...scope, reason: ExecutionError.InvalidOperationReference },
      );
    }
    const { sourceName, reference: operationId } = parsed;
    const openapiDocument = await this.#sourceDocument(sourceName, document, scope);
    const jsonPointer = openapiDocument.operationIndex.get(operationId);
    if (jsonPointer === undefined) {
      throw new ExecutionError(
        `Operation "${operationId}" not found in source description "${sourceName}" at "${openapiDocument.uri}"`,
        { ...scope, reason: ExecutionError.OperationNotFound },
      );
    }
    return {
      document: openapiDocument,
      jsonPointer,
      sourceDescription: { name: sourceName, documentURI: document.uri },
    };
  }

  /**
   * Resolves a plain operationId against the single OpenAPI source description.
   *
   * Per the Arazzo Specification a plain operationId is only valid when a single
   * non-arazzo source description is defined; multiple such sources require the
   * `$sourceDescriptions` expression form. The first OpenAPI source is therefore
   * the one it targets: the operationId is looked up there and the lookup fails
   * if it is absent — subsequent OpenAPI sources are not searched (their
   * presence would make the plain operationId ambiguous, and hence invalid).
   * Non-OpenAPI (arazzo) sources are skipped. Sources are acquired one at a time
   * until the first OpenAPI source is reached.
   */
  async #resolvePlainOperationId(
    operationId: string,
    document: ArazzoDocument,
    scope: StepScope | undefined,
  ): Promise<OpenAPIOperationLocator> {
    for (const [name, { uri }] of document.sourceDescriptionIndex) {
      if (uri === undefined) continue;
      const source = await this.registry.acquire(uri);
      if (!OpenAPIDocument.is(source)) continue;

      const jsonPointer = source.operationIndex.get(operationId);
      if (jsonPointer === undefined) {
        throw new ExecutionError(
          `Operation "${operationId}" not found in source description at "${source.uri}"`,
          { ...scope, reason: ExecutionError.OperationNotFound },
        );
      }
      return {
        document: source,
        jsonPointer,
        sourceDescription: { name, documentURI: document.uri },
      };
    }

    // no source was named, so this is not a missing source description: there
    // is simply no OpenAPI document for the operation to be in.
    throw new ExecutionError(
      `Operation "${operationId}" not found: the Arazzo document at "${document.uri}" has no OpenAPI source description`,
      { ...scope, reason: ExecutionError.OperationNotFound },
    );
  }

  /**
   * Acquires a source description by name and asserts it is an OpenAPI document.
   */
  async #sourceDocument(
    sourceName: string,
    document: ArazzoDocument,
    scope: StepScope | undefined,
  ): Promise<OpenAPIDocument> {
    const uri = document.resolveSourceDescriptionURI(sourceName);
    if (uri === undefined) {
      throw new ExecutionError(
        `Source description "${sourceName}" not found in the Arazzo document at "${document.uri}"`,
        { ...scope, reason: ExecutionError.SourceDescriptionNotFound },
      );
    }
    const source = await this.registry.acquire(uri);
    if (!OpenAPIDocument.is(source)) {
      throw new ExecutionError(
        `Source description "${sourceName}" at "${uri}" is not an OpenAPI document`,
        { ...scope, reason: ExecutionError.SourceDescriptionNotOpenAPI },
      );
    }
    return source;
  }
}

export default OpenAPIOperationLocatorNormalizer;

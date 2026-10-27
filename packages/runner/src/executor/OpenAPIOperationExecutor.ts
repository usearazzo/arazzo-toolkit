import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isObjectElement } from '@speclynx/apidom-datamodel';
import { url as urlUtils } from '@speclynx/apidom-reference/configuration/empty';
import {
  isSwaggerElement,
  isParameterElement,
  type ParameterElement as ParameterElement2,
} from '@speclynx/apidom-ns-openapi-2';
import {
  serializeCookie,
  cookieNameLenientValidator,
  cookieValueStrictPercentEncoder,
} from '@swaggerexpert/cookie';
import { identify, matches, selectBestMatch } from '@swaggerexpert/media-types';
import { isPlainObject } from 'ramda-adjunct';

// @ts-expect-error vendored swagger-client bundle has no type declarations
import { buildRequest, idFromPathMethodLegacy } from '../vendor/swagger-client.mjs';
import ParameterDelivery from '../client/ParameterDelivery.ts';
import type HTTPClient from '../client/HTTPClient.ts';
import httpClientFetch from '../client/HTTPClientFetch.ts';
import type { OpenAPIOperationElement } from '../document/openapi-types.ts';
import type OpenAPIDocument from '../document/OpenAPIDocument.ts';
import type OpenAPIOperationRequest from '../client/OpenAPIOperationRequest.ts';
import type OpenAPIOperationResponse from '../client/OpenAPIOperationResponse.ts';
import type { OpenAPIOperationRequestInfo } from '../client/OpenAPIOperationResponse.ts';
import OpenAPIOperationResponseNormalizer from '../client/OpenAPIOperationResponseNormalizer.ts';
import OpenAPIOperationExtractor from '../extractor/OpenAPIOperationExtractor.ts';
import OpenAPIOperationNormalizer from '../normalizer/OpenAPIOperationNormalizer.ts';
import OpenAPIDocumentAssembler from '../assembler/OpenAPIDocumentAssembler.ts';
import ClientError from '../errors/ClientError.ts';
import type { OpenAPIOperationLocator } from './OpenAPIOperationLocatorNormalizer.ts';

/**
 * Decorates the built request before it is handed to the {@link HTTPClient}.
 *
 * Receives the finalized {@link OpenAPIOperationRequest} and may mutate it in
 * place or return a replacement; returning nothing keeps the received request.
 * May be synchronous or asynchronous.
 * @public
 */
export type RequestInterceptor = (
  request: OpenAPIOperationRequest,
) => OpenAPIOperationRequest | void | Promise<OpenAPIOperationRequest | void>;

/**
 * The plain-JSON shape of the assembled document, as far as declaring a
 * parameter on its one operation needs it.
 */
interface AssembledSpec {
  paths: Record<string, Record<string, { parameters?: unknown[] }>>;
}

/**
 * A caller-supplied parameter the operation does not declare, in a location
 * it can still be delivered to.
 */
interface UndeclaredParameter {
  readonly location: 'header' | 'query' | 'cookie' | 'path';
  readonly name: string;
  readonly value: unknown;
}

const UNDECLARED_LOCATIONS = new Set(['header', 'query', 'cookie', 'path']);

// the header parameters OpenAPI 3 says SHALL be ignored, which buildRequest drops
const IGNORED_HEADERS = new Set(['accept', 'authorization', 'content-type']);

/**
 * Options for executing an OpenAPI operation.
 *
 * All fields are forwarded to the vendored swagger-client `buildRequest`
 * (which owns parameter serialization, security application, and server URL
 * resolution), except `requestInterceptor`, which the executor runs between
 * building the request and sending it.
 *
 * Typed here are the options the runner itself drives and the ones callers
 * routinely reach for. The rest of `buildRequest`'s surface (`securities`,
 * `scheme`, `parameterBuilders`, `attachContentTypeForEmptyPayload`, …) is
 * deliberately left untyped and passes through the bag's open tail unchanged —
 * see {@link OpenAPIOperationExecuteOptionsBag}. Authentication in particular
 * is not modeled: Arazzo is auth-agnostic, so credentials are applied with a
 * {@link RequestInterceptor}.
 * @public
 */
export interface OpenAPIOperationExecuteOptions {
  readonly parameters?: Record<string, unknown>;
  readonly requestBody?: unknown;
  /**
   * The media type of the request body, sent as the `Content-Type` header (the
   * Arazzo `requestBody.contentType`). Matched against the media types the
   * operation declares under `requestBody.content`, ignoring case and any
   * parameters it carries, and accepting a declared range (`type/*`, or the
   * all-media-types range) as covering a concrete type. The authored value is
   * sent in full whichever declaration it matched.
   *
   * The form media types are the exception: `application/x-www-form-urlencoded`
   * and `multipart/form-data` decide how the body is encoded, so they must be
   * declared exactly rather than by a range. A media type matching nothing
   * throws rather than sending an empty or wrongly encoded body.
   */
  readonly requestContentType?: string;
  /**
   * The media type to ask for in the response, sent as the `Accept` header.
   * When omitted, `Accept` is derived from the media types the operation
   * declares for its 2xx responses.
   */
  readonly responseContentType?: string;
  /**
   * The server to send the request to. A value matching a declared server's
   * `url` selects it and brings that server's variable defaults along; any
   * other value is used as the base URL directly, so pointing a workflow at
   * another environment needs no special option. Relative values resolve
   * against the document's own URL. Works the same for OpenAPI 2.0 and 3.x.
   *
   * Defaults to the first server the operation declares (for 2.0, the
   * document's `schemes`/`host`/`basePath`), resolved against the URL the
   * document was loaded from.
   */
  readonly server?: string;
  /**
   * Substitutions for a selected server's URL template, layered over the
   * variable defaults declared in the document. OpenAPI 3.x only, and only for
   * a declared server — an override carries no declared variables.
   */
  readonly serverVariables?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly requestInterceptor?: RequestInterceptor;
}

/**
 * The execute options forwarded to {@link OpenAPIOperationExecutor.execute}.
 *
 * The {@link OpenAPIOperationExecuteOptions} fields are surfaced for
 * type-checked callers, while the open `Record` tail keeps the bag opaque so
 * the rest of `buildRequest`'s surface (`scheme`, `parameterBuilders`,
 * `attachContentTypeForEmptyPayload`, …) passes through untouched.
 *
 * Nothing routine belongs in the tail. Credentials go through a
 * {@link RequestInterceptor} and `server` covers every case that once needed a
 * `contextUrl`, so reaching for either of those here means an edge case: tests
 * standing in for a document fetched over HTTP, or credentials applied from the
 * document's own security schemes.
 *
 * Two kinds of entry are inert rather than honored, since the executor owns
 * what they used to control. The operation target always comes from the
 * locator, so `operationId`/`operationPath` have no effect; and the options
 * only swagger-client's `execute()` ever read — `userFetch` and
 * `responseInterceptor`, which the runner replaces with `httpClient` and
 * `responseNormalizer` — reach `buildRequest` but nothing acts on them.
 * @public
 */
export type OpenAPIOperationExecuteOptionsBag = OpenAPIOperationExecuteOptions &
  Record<string, unknown>;

/**
 * Options for the OpenAPIOperationExecutor.
 * @public
 */
export interface OpenAPIOperationExecutorOptions {
  /**
   * The transport that sends the built request and resolves with the raw
   * WHATWG `Response`. Defaults to {@link httpClientFetch} (global fetch).
   */
  readonly httpClient?: HTTPClient;
  /**
   * Decorates every built request (e.g. an `Authorization` header) before the
   * per-call interceptor from the execute options bag runs.
   */
  readonly requestInterceptor?: RequestInterceptor;
  /**
   * Normalizes the raw `Response` into the runner's response model. Defaults
   * to a fresh {@link OpenAPIOperationResponseNormalizer}.
   */
  readonly responseNormalizer?: OpenAPIOperationResponseNormalizer;
  /**
   * Extracts the operation element from its owning document. Defaults to a
   * fresh {@link OpenAPIOperationExtractor}.
   */
  readonly operationExtractor?: OpenAPIOperationExtractor;
  /**
   * Normalizes the extracted operation (servers, parameters, securities).
   * Defaults to a fresh {@link OpenAPIOperationNormalizer}.
   */
  readonly operationNormalizer?: OpenAPIOperationNormalizer;
  /**
   * Assembles the standalone OpenAPI document for the operation. Defaults to a
   * fresh {@link OpenAPIDocumentAssembler}.
   */
  readonly documentAssembler?: OpenAPIDocumentAssembler;
}

/**
 * Executes a single OpenAPI operation named by a canonical
 * {@link OpenAPIOperationLocator}.
 *
 * The pipeline extracts the operation from its owning document, normalizes it,
 * assembles a minimal standalone OpenAPI document containing just that
 * operation, builds the HTTP request with the vendored swagger-client
 * `buildRequest` (parameter serialization, securities, server resolution),
 * sends it through the pluggable {@link HTTPClient}, and normalizes the raw
 * `Response` into the runner's response model. A non-2xx status is a valid
 * outcome (judged by a step's `successCriteria`) and is returned, never
 * thrown; a transport failure is wrapped as a {@link ClientError}.
 *
 * The executor is Arazzo-agnostic: it neither locates the operation (that is
 * the operation locator normalizer's concern) nor resolves parameters or
 * request bodies from runtime expressions (the step executor's concern). It
 * receives an already-resolved locator and an opaque bag of execute options,
 * and returns the normalized operation response carrying the request that was
 * actually sent, so `$url` / `$method` / `$request.*` can be evaluated after
 * execution.
 * @public
 */
class OpenAPIOperationExecutor {
  readonly #httpClient: HTTPClient;
  readonly #requestInterceptor: RequestInterceptor | undefined;
  readonly #responseNormalizer: OpenAPIOperationResponseNormalizer;
  readonly #operationExtractor: OpenAPIOperationExtractor;
  readonly #operationNormalizer: OpenAPIOperationNormalizer;
  readonly #documentAssembler: OpenAPIDocumentAssembler;

  constructor(options: OpenAPIOperationExecutorOptions = {}) {
    this.#httpClient = options.httpClient ?? httpClientFetch;
    this.#requestInterceptor = options.requestInterceptor;
    this.#responseNormalizer =
      options.responseNormalizer ?? new OpenAPIOperationResponseNormalizer();
    this.#operationExtractor = options.operationExtractor ?? new OpenAPIOperationExtractor();
    this.#operationNormalizer = options.operationNormalizer ?? new OpenAPIOperationNormalizer();
    this.#documentAssembler = options.documentAssembler ?? new OpenAPIDocumentAssembler();
  }

  /**
   * Executes the located operation, returning the normalized operation
   * response.
   *
   * `executeOptions` is an opaque bag of `buildRequest` options (e.g. resolved
   * `parameters`, a `requestBody` and its `requestContentType`, or a `server`).
   * The operation target always takes precedence over it: the
   * locator's JSON Pointer selects the operation in the assembled document, so
   * `operationId`/`operationPath` entries in the bag cannot hijack the
   * operation.
   */
  async execute(
    locator: OpenAPIOperationLocator,
    executeOptions: OpenAPIOperationExecuteOptionsBag = {},
  ): Promise<OpenAPIOperationResponse> {
    // extraction validates the locator first: a pointer naming anything but an
    // operation would otherwise crash inside normalization
    const operation = this.#operationExtractor.extractByPointer(
      locator.document,
      locator.jsonPointer,
    );
    // the legacy id (`{method}-{path}`) matches regardless of an explicit
    // `operationId` in the assembled document
    const operationId = idFromPathMethodLegacy(
      toValue(operation.meta.get('path')) as string,
      toValue(operation.meta.get('http-method')) as string,
    ) as string;
    const normalizedOperation = await this.#operationNormalizer.normalize(
      operation,
      locator.document,
    );
    const assembled = this.#documentAssembler.assemble(normalizedOperation, locator.document);

    // the interceptor is consumed here, and the target always comes from the
    // locator, so both operation keys are dropped rather than rest
    const { requestInterceptor, operationId: _, operationPath: __, ...rest } = executeOptions;

    // each step derives the next options rather than editing in place
    const withServer = this.#applyServerOptions(rest, normalizedOperation, locator.document);
    const withBody = this.#adaptRequestBody(
      withServer,
      normalizedOperation,
      locator.document,
      locator.jsonPointer,
    );
    const buildOptions = this.#adaptRequestContentType(
      withBody,
      normalizedOperation,
      locator.document,
      locator.jsonPointer,
    );

    const undeclared = this.#undeclaredParameters(
      buildOptions.parameters,
      normalizedOperation,
      locator.document,
    );
    const spec = assembled.toJSON() as AssembledSpec;
    this.#declareQueryAndPathParameters(
      spec,
      undeclared,
      toValue(operation.meta.get('path')) as string,
      toValue(operation.meta.get('http-method')) as string,
      locator,
    );

    let request: OpenAPIOperationRequest;
    try {
      request = buildRequest({ ...buildOptions, spec, operationId }) as OpenAPIOperationRequest;
    } catch (error: unknown) {
      throw new ClientError('Failed to build request for OpenAPI operation', {
        operationPath: locator.jsonPointer,
        cause: error,
      });
    }

    // a differing value means #adaptRequestContentType swapped the authored
    // media type for the declared one so the body would attach; the header
    // still goes out as authored, parameters and all
    const authoredContentType = executeOptions.requestContentType;
    if (
      typeof authoredContentType === 'string' &&
      buildOptions.requestContentType !== authoredContentType
    ) {
      request.headers['Content-Type'] = authoredContentType;
    }

    this.#deliverHeadersAndCookies(request, undeclared);
    request = await this.#finalizeRequest(request, requestInterceptor);

    // capture the request as sent, so `$url` / `$method` / `$request.*` can be
    // evaluated after execution; headers are copied so a transport-side
    // mutation cannot rewrite the record
    const requestInfo: OpenAPIOperationRequestInfo = {
      url: request.url,
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
    };

    let rawResponse: Response;
    try {
      rawResponse = await this.#httpClient(request);
    } catch (error: unknown) {
      throw new ClientError('OpenAPI operation request failed', {
        operationPath: locator.jsonPointer,
        cause: error,
      });
    }

    return this.#responseNormalizer.normalize(rawResponse, requestInfo);
  }

  /**
   * The `{in}.{name}`-keyed parameters (see {@link ParameterDelivery}) in a
   * header, query, cookie or path location that the operation does not
   * declare. `buildRequest` delivers only what the operation declares, yet a
   * step's parameters are what its author asked to send — an `Authorization`
   * header carrying a token from an earlier step most of all, which OpenAPI 3
   * cannot even declare. A declared OpenAPI 3 `Accept`, `Authorization` or
   * `Content-Type` header parameter counts as undeclared too: `buildRequest`
   * drops it, as that specification requires. Bare keys are left to
   * `buildRequest`: they name no location to deliver to.
   */
  #undeclaredParameters(
    parameters: unknown,
    operation: OpenAPIOperationElement,
    document: OpenAPIDocument,
  ): UndeclaredParameter[] {
    if (!isPlainObject(parameters)) return [];
    const isSwagger = isSwaggerElement(document.parseResult.api);
    const declared = new Set(
      (isArrayElement(operation.parameters) ? [...operation.parameters] : [])
        .filter(isObjectElement)
        .map((parameter) => `${toValue(parameter.get('in'))}.${toValue(parameter.get('name'))}`),
    );

    return Object.entries(parameters as Record<string, unknown>).flatMap(([key, value]) => {
      const separator = key.indexOf('.');
      const location = key.slice(0, separator);
      const name = key.slice(separator + 1);
      // an unresolved expression or a null delivers nothing, as buildRequest
      // does for a declared parameter
      if (
        separator === -1 ||
        !UNDECLARED_LOCATIONS.has(location) ||
        value === undefined ||
        value === null
      ) {
        return [];
      }
      const ignored =
        !isSwagger && location === 'header' && IGNORED_HEADERS.has(name.toLowerCase());
      return declared.has(key) && !ignored
        ? []
        : [{ location, name, value } as UndeclaredParameter];
    });
  }

  /**
   * Declares the undeclared query and path parameters on the assembled
   * operation, so `buildRequest` serializes and encodes them as it does
   * declared ones. A path parameter is declared only when the path has its
   * `{name}` template expression; otherwise there is nowhere to put it, and
   * that authoring error throws {@link ClientError} rather than sending a
   * request without it.
   */
  #declareQueryAndPathParameters(
    spec: AssembledSpec,
    undeclared: readonly UndeclaredParameter[],
    path: string,
    method: string,
    locator: OpenAPIOperationLocator,
  ): void {
    const operation = spec.paths[path]![method]!;
    const isSwagger = isSwaggerElement(locator.document.parseResult.api);
    for (const { location, name } of undeclared) {
      if (location !== 'query' && location !== 'path') continue;
      if (location === 'path' && !path.includes(`{${name}}`)) {
        throw new ClientError(
          `Path parameter "${name}" is not declared by the operation and its path "${path}" ` +
            `has no "{${name}}" to substitute it into`,
          { operationPath: locator.jsonPointer },
        );
      }
      const required = location === 'path';
      (operation.parameters ??= []).push(
        isSwagger
          ? { name, in: location, required, type: 'string' }
          : { name, in: location, required, schema: {} },
      );
    }
  }

  /**
   * Sets the undeclared header parameters on the built request and appends the
   * undeclared cookie parameters to its `Cookie` header. A header replaces any
   * value the build gave it under any spelling — the default `Accept`, say —
   * since the step naming it is the more specific intent. OpenAPI 2.0 has no
   * cookie location, so its cookies always go this way.
   */
  #deliverHeadersAndCookies(
    request: OpenAPIOperationRequest,
    undeclared: readonly UndeclaredParameter[],
  ): void {
    const present = (name: string): string | undefined =>
      Object.keys(request.headers).find((header) => header.toLowerCase() === name.toLowerCase());

    for (const { location, name, value } of undeclared) {
      if (location !== 'header') continue;
      const built = present(name);
      if (built !== undefined) delete request.headers[built];
      request.headers[name] = this.#stringify(value);
    }

    const cookies = undeclared
      .filter(({ location }) => location === 'cookie')
      .map(({ name, value }): [string, string] => [name, this.#stringify(value)]);
    if (cookies.length === 0) return;
    // serialized as buildRequest serializes a declared cookie, so a `;` in the
    // value is percent-encoded rather than splitting it into further cookies
    const serialized = serializeCookie(cookies, {
      encoders: { value: cookieValueStrictPercentEncoder },
      validators: { name: cookieNameLenientValidator },
    });
    const cookieHeader = present('Cookie') ?? 'Cookie';
    const existing = request.headers[cookieHeader];
    request.headers[cookieHeader] = existing ? `${existing}; ${serialized}` : serialized;
  }

  /**
   * A header or cookie value with no schema to serialize it by, the way
   * OpenAPI's default for those locations (`simple` and `form`, not exploded)
   * serializes a declared one: an array as `a,b`, an object as `k,v,k2,v2`,
   * anything else via `String()`.
   */
  #stringify(value: unknown): string {
    if (Array.isArray(value)) return value.map(String).join(',');
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flat().map(String).join(',');
    }
    return String(value);
  }

  /**
   * Derives where the request is sent, returning the options to build with.
   *
   * swagger-client already selects a declared server, substitutes its variables
   * and resolves relative URLs — the one thing it gets wrong is what to do with
   * a `server` matching nothing it declared, which it silently swaps for the
   * first declared server. Here that value becomes an override instead: the URL
   * you name is the URL that is called, whatever the document declares. Passing
   * it as `baseURL` bypasses swagger-client's own server resolution, which also
   * makes `server` work on Swagger 2.0, where it is otherwise ignored.
   *
   * A relative server resolves against the URL the document was loaded from,
   * which is what `contextUrl` means, so it is derived rather than asked for.
   * Only an HTTP(S) document URL qualifies. Swagger 2.0 falls back to the
   * context URL's protocol when the document declares no `schemes`, so a `file:`
   * URL would yield `file://host/basePath` instead of `http://…`. The registry
   * normalizes `file:` URIs to bare filesystem paths, which carry no protocol
   * and are harmless, so this is a guard on the invariant rather than on a
   * reachable state today. A caller-supplied `contextUrl` still wins, for
   * resolving against somewhere the document did not come from.
   */
  #applyServerOptions(
    buildOptions: Record<string, unknown>,
    operation: OpenAPIOperationElement,
    document: OpenAPIDocument,
  ): Record<string, unknown> {
    const resolved =
      buildOptions.contextUrl === undefined && urlUtils.isHttpUrl(document.uri)
        ? { ...buildOptions, contextUrl: document.uri }
        : buildOptions;

    const { server, ...withoutServer } = resolved;
    if (typeof server !== 'string') return resolved;

    // the operation normalizer has already inherited servers down from the
    // document root, including the spec's default `[{ url: '/' }]`. spread into
    // a real array rather than using ArrayElement's own find(), which returns an
    // empty ArrayElement on a miss — truthy, so every server would look declared.
    // the members are Server elements, but isObjectElement keeps this one code
    // path valid for every version: isServerElement is per-namespace, and the
    // 3.1 one rejects 3.0 servers
    const servers = operation.get('servers');
    const declared = isArrayElement(servers) ? [...servers] : [];
    const isDeclared = declared.some(
      (candidate) => isObjectElement(candidate) && toValue(candidate.get('url')) === server,
    );
    if (isDeclared) return resolved;

    const baseURL = urlUtils.hasProtocol(server)
      ? server
      : urlUtils.resolve((resolved.contextUrl as string | undefined) ?? '', server);

    // buildRequest concatenates the base and the path verbatim, so a trailing
    // slash would double up. swagger-client trims one in its own resolution too
    return { ...withoutServer, baseURL: baseURL.replace(/\/$/, '') };
  }

  /**
   * Reconciles the requested body media type with the ones the operation
   * declares, returning the options to build with. A rewritten
   * `requestContentType` is what tells `execute` to restore the authored value
   * onto the header afterwards.
   *
   * swagger-client attaches the body only when `requestContentType` is an exact
   * key of `requestBody.content`, and otherwise drops the body *and* the header
   * without a word. Media types are richer than that: they carry optional
   * parameters and their names are case-insensitive, so the Arazzo
   * `application/json; charset=utf-8` and `Application/JSON` both name a
   * declared `application/json`. Both are matched here, the request is built
   * under the declared spelling, and the authored value is restored onto the
   * header afterwards. A type naming nothing declared is an authoring error and
   * is raised rather than turned into an empty request.
   *
   * Only OpenAPI 3.x declares media types this way. A Swagger 2.0 operation has
   * no `requestBody` to check against, so its content type passes through for
   * `consumes` to govern.
   */
  #adaptRequestContentType(
    buildOptions: Record<string, unknown>,
    operation: OpenAPIOperationElement,
    document: OpenAPIDocument,
    jsonPointer: string,
  ): Record<string, unknown> {
    const requested = buildOptions.requestContentType;
    if (typeof requested !== 'string' || buildOptions.requestBody === undefined) {
      return buildOptions;
    }
    if (isSwaggerElement(document.parseResult.api)) return buildOptions;

    const requestBody = operation.get('requestBody');
    const content = isObjectElement(requestBody) ? requestBody.get('content') : undefined;
    if (!isObjectElement(content)) {
      throw new ClientError(
        `Request body media type "${requested}" cannot be sent: the operation declares ` +
          'no request body content. Omit the content type to send the payload as-is',
        { operationPath: jsonPointer },
      );
    }

    const declared = content.keys() as string[];
    if (declared.includes(requested)) return buildOptions;

    // a range or a malformed value names no concrete media type to send
    if (identify(requested) !== 'media-type') {
      throw new ClientError(`Request body media type "${requested}" is not a valid media type`, {
        operationPath: jsonPointer,
      });
    }

    // a form media type decides how the body is encoded, and buildRequest applies
    // that encoding only for an exactly declared type. matching one against a
    // range would put a JSON body behind a form Content-Type
    const isFormEncoded =
      matches('application/x-www-form-urlencoded', requested) ||
      matches('multipart/form-data', requested);

    // otherwise a declared range covers a concrete type, so `*/*` (what several
    // generators emit by default) accepts anything; the most specific wins.
    // parameters on one side only (a declared `charset=utf-8`) describe the
    // content rather than constrain it, while conflicting ones never match
    const candidates = isFormEncoded
      ? declared.filter((mediaType) => identify(mediaType) === 'media-type')
      : declared;
    const match = selectBestMatch(candidates, requested, { parameterMatching: 'compatible' });
    if (match === null) {
      throw new ClientError(
        isFormEncoded
          ? `Request body media type "${requested}" must be declared by the operation exactly, ` +
              `since it decides how the body is encoded (declared: [${declared.join(', ')}])`
          : `Request body media type "${requested}" is not declared by the operation ` +
              `(declared: [${declared.join(', ')}])`,
        { operationPath: jsonPointer },
      );
    }

    return { ...buildOptions, requestContentType: match };
  }

  /**
   * Routes a request body through the convention the target OpenAPI version
   * uses, leaving OpenAPI 3.x calls untouched.
   *
   * Swagger 2.0 has no request body concept — the payload is an ordinary
   * parameter declared `in: body`, or a set of `in: formData` ones — so it must
   * travel through `parameters` under the names the operation declares. Arazzo
   * cannot express that itself (its parameter `in` allows only `path`, `query`,
   * `querystring`, `header`, and `cookie`), which is why the translation lives
   * here, where the assembled document has those parameters dereferenced and
   * inherited.
   *
   * The payload travels under {@link ParameterDelivery} keys
   * (`body.{name}`, `formData.{name}`), never bare names: a bare key would
   * capture a same-named parameter in another location — 2.0 legally declares
   * e.g. `petId` in `path` and in `formData` at once — per the lookup order
   * documented on {@link ParameterDelivery}.
   *
   * A *bare* `parameters` entry bearing a payload target's name is rejected
   * with {@link ClientError} rather than resolved either way: before the
   * qualified keys the payload silently overwrote it, after them the bare key
   * would silently outrank the payload at the client's bare-first lookup —
   * both wrong for somebody, so the ambiguity is reported instead. Such an
   * entry can come from a direct caller mixing bare parameters with a request
   * body, or from the runner's own pipeline: the parameter resolver keeps a
   * `querystring` parameter under its bare name.
   */
  #adaptRequestBody(
    buildOptions: Record<string, unknown>,
    operation: OpenAPIOperationElement,
    document: OpenAPIDocument,
    jsonPointer: string,
  ): Record<string, unknown> {
    if (!isSwaggerElement(document.parseResult.api) || buildOptions.requestBody === undefined) {
      return buildOptions;
    }

    const { requestBody, parameters: given, ...rest } = buildOptions;
    const callerParameters = given as Record<string, unknown> | undefined;
    // an operation declaring none leaves `parameters` absent rather than empty,
    // and that case still has to reach the throw below
    const declared = operation.parameters;
    const parameters = (
      isArrayElement(declared) ? [...declared.filter(isParameterElement)] : []
    ) as ParameterElement2[];

    // the body parameter's name is arbitrary, so the payload wins over a
    // same-keyed entry the caller supplied
    const body = parameters.find((parameter) => toValue(parameter.in) === 'body');
    if (body !== undefined) {
      const name = toValue(body.name) as string;
      this.#rejectBarePayloadConflicts(callerParameters, [name], jsonPointer);
      return {
        ...rest,
        parameters: {
          ...callerParameters,
          [ParameterDelivery.keyFor('body', name)]: requestBody,
        },
      };
    }

    // formData models each field as its own parameter, so the payload's keys
    // are the parameter names; buildRequest reports any that do not match
    const hasForm = parameters.some((parameter) => toValue(parameter.in) === 'formData');
    if (hasForm) {
      if (!isPlainObject(requestBody)) {
        throw new ClientError(
          'Request body cannot be sent: the OpenAPI 2.0 operation carries it in "formData" ' +
            'parameters, so the payload must be an object keyed by their names',
          { operationPath: jsonPointer },
        );
      }
      const payload = requestBody as Record<string, unknown>;
      this.#rejectBarePayloadConflicts(callerParameters, Object.keys(payload), jsonPointer);
      const merged: Record<string, unknown> = { ...callerParameters };
      for (const [field, value] of Object.entries(payload)) {
        merged[ParameterDelivery.keyFor('formData', field)] = value;
      }
      return { ...rest, parameters: merged };
    }

    throw new ClientError(
      'Request body cannot be sent: the OpenAPI 2.0 operation declares no "body" or ' +
        '"formData" parameter to carry it',
      { operationPath: jsonPointer },
    );
  }

  /**
   * Rejects bare `parameters` entries bearing the names the payload is about
   * to be delivered under — the client consults bare names before qualified
   * keys, so such an entry would silently displace the request body (see
   * {@link OpenAPIOperationExecutor.#adaptRequestBody}).
   */
  #rejectBarePayloadConflicts(
    callerParameters: Record<string, unknown> | undefined,
    payloadNames: readonly string[],
    jsonPointer: string,
  ): void {
    if (callerParameters === undefined) return;
    const conflicts = payloadNames.filter((name) => Object.hasOwn(callerParameters, name));
    if (conflicts.length === 0) return;
    throw new ClientError(
      `Request body cannot be sent: bare parameter ${conflicts.length === 1 ? 'entry' : 'entries'} ` +
        `[${conflicts.join(', ')}] would displace the payload at delivery. Supply the ` +
        `parameter under its "{in}.{name}" key, or drop the duplicate`,
      { operationPath: jsonPointer },
    );
  }

  /**
   * Applies the wire-level fixups swagger-client performs between building a
   * request and fetching it, and runs the request interceptors: the
   * executor-level one first, the per-call one from the options bag second.
   *
   * Ported rather than imported: upstream keeps them inline in `execute()` and
   * `http()`, which also fetch and throw on a non-2xx. Diff against those two
   * when bumping swagger-client.
   */
  async #finalizeRequest(
    request: OpenAPIOperationRequest,
    perCallInterceptor: RequestInterceptor | undefined,
  ): Promise<OpenAPIOperationRequest> {
    let finalized = request;

    // JSON-encode plain-object and array bodies, exactly as swagger-client's
    // execute() does before handing the request to its transport
    if (finalized.body && (isPlainObject(finalized.body) || Array.isArray(finalized.body))) {
      finalized.body = JSON.stringify(finalized.body);
    }

    // an embedded newline makes a header value invalid per the Fetch standard,
    // so fetch throws a TypeError before sending anything. squashing repairs it,
    // and since the request is captured after this, the record shows the value
    // that actually went out
    Object.keys(finalized.headers).forEach((headerName) => {
      const value = finalized.headers[headerName];
      if (typeof value === 'string') {
        finalized.headers[headerName] = value.replace(/\n+/g, ' ');
      }
    });

    finalized = (await this.#requestInterceptor?.(finalized)) ?? finalized;
    finalized = (await perCallInterceptor?.(finalized)) ?? finalized;

    // for multipart/form-data, remove the built content-type so the transport
    // sets one carrying the correct boundary
    const contentType = finalized.headers['content-type'] ?? finalized.headers['Content-Type'];
    if (typeof contentType === 'string' && /multipart\/form-data/i.test(contentType)) {
      delete finalized.headers['content-type'];
      delete finalized.headers['Content-Type'];
    }
    return finalized;
  }
}

export default OpenAPIOperationExecutor;

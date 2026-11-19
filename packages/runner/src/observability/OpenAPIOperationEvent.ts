import type { RequestContext } from '../executor/OpenAPIOperationExecutor.ts';
import type { DocumentLocation } from '../document/APIDocument.ts';
import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The fields every {@link OpenAPIOperationEvent} carries: the operation, and
 * the step it runs for, in the same shape a {@link RequestInterceptor}
 * receives them.
 * @public
 */
export interface OpenAPIOperationEventBase extends ArazzoRunnerEventBase, RequestContext {
  /**
   * Where the operation is written. It differs from `operation` (where the
   * operation was looked up) for an operation of a Path Item Object written
   * as a `$ref`, which is written in the document the reference names.
   */
  readonly location: DocumentLocation;
}

/**
 * Normalization of the operation began: dereferencing it (which may fetch
 * externally referenced documents) and inheriting its path-level fields.
 * @public
 */
export interface OpenAPIOperationNormalizeStartEvent extends OpenAPIOperationEventBase {
  readonly type: 'openapi-operation-normalize-start';
}

/**
 * The operation was normalized.
 * @public
 */
export interface OpenAPIOperationNormalizeSettledEvent extends OpenAPIOperationEventBase {
  readonly type: 'openapi-operation-normalize-settled';
}

/**
 * The normalized operation was assembled into the OpenAPI document the
 * request is built from.
 * @public
 */
export interface OpenAPIOperationAssembledEvent extends OpenAPIOperationEventBase {
  readonly type: 'openapi-operation-assembled';
}

/**
 * The request about to be handed to the {@link HTTPClient}, after every
 * request interceptor ran, as it is sent: credentials included, like the
 * request an interceptor receives. Mask it with {@link Redactor} before it
 * leaves the process.
 * @public
 */
export interface OpenAPIOperationRequestStartEvent extends OpenAPIOperationEventBase {
  readonly type: 'openapi-operation-request-start';
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    /**
     * The body as handed to the {@link HTTPClient}: JSON or form text, or a
     * `FormData`, `Blob` or stream. Only with
     * {@link OpenAPIOperationExecutorOptions.captureBodies}.
     */
    readonly body?: unknown;
  };
}

/**
 * The response was received and its body read, as it came: mask it with
 * {@link Redactor} before it leaves the process. A request that fails in the
 * transport throws and emits no settled event.
 * @public
 */
export interface OpenAPIOperationRequestSettledEvent extends OpenAPIOperationEventBase {
  readonly type: 'openapi-operation-request-settled';
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    /**
     * The body's size in bytes: {@link OpenAPIOperationResponse.size}.
     */
    readonly size: number;
    /**
     * The body parsed by its content type, as `$response.body` reads it. Only
     * with {@link OpenAPIOperationExecutorOptions.captureBodies}.
     */
    readonly body?: unknown;
  };
}

/**
 * An event the {@link OpenAPIOperationExecutor} emits.
 * @public
 */
export type OpenAPIOperationEvent =
  | OpenAPIOperationNormalizeStartEvent
  | OpenAPIOperationNormalizeSettledEvent
  | OpenAPIOperationAssembledEvent
  | OpenAPIOperationRequestStartEvent
  | OpenAPIOperationRequestSettledEvent;

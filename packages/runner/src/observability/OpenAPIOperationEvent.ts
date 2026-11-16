import type { RequestContext } from '../executor/OpenAPIOperationExecutor.ts';
import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The fields every {@link OpenAPIOperationEvent} carries: the operation, and
 * the step it runs for, in the same shape a {@link RequestInterceptor}
 * receives them.
 * @public
 */
export interface OpenAPIOperationEventBase extends ArazzoRunnerEventBase, RequestContext {
  /**
   * The `runId` of the {@link WorkflowExecutor.execute} call the operation
   * runs for, from the execute options. Absent when the executor is used
   * without one.
   */
  readonly runId?: string;
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
 * A body an `openapi-operation-request-*` event carries, with
 * {@link OpenAPIOperationExecutorOptions.captureBodies} on.
 * @public
 */
export interface OpenAPIOperationEventBody {
  /**
   * The body as text. Absent for a body that is not text.
   */
  readonly text?: string;
  /**
   * The body's size in bytes, when known.
   */
  readonly size?: number;
  /**
   * Set by {@link Redactor} when it cut `text` to its limit.
   */
  readonly truncated?: boolean;
}

/**
 * The fields both `openapi-operation-request-*` events carry.
 *
 * These events carry the exchange as it was sent and received, credentials
 * included, like the request an interceptor receives. Mask them with
 * {@link Redactor} before they leave the process.
 * @public
 */
export interface OpenAPIOperationExchangeEventBase extends OpenAPIOperationEventBase {
  /**
   * The header, query parameter and cookie names the document's security
   * schemes put credentials under, for {@link Redactor} to mask whatever its
   * patterns say.
   */
  readonly credentials: readonly string[];
}

/**
 * The request about to be handed to the {@link HTTPClient}, after every
 * request interceptor ran.
 * @public
 */
export interface OpenAPIOperationRequestStartEvent extends OpenAPIOperationExchangeEventBase {
  readonly type: 'openapi-operation-request-start';
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: OpenAPIOperationEventBody;
  };
}

/**
 * The response was received and its body read. A request that fails in the
 * transport throws and emits no settled event.
 * @public
 */
export interface OpenAPIOperationRequestSettledEvent extends OpenAPIOperationExchangeEventBase {
  readonly type: 'openapi-operation-request-settled';
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: OpenAPIOperationEventBody;
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

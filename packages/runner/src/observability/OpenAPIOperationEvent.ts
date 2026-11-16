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
 * An event the {@link OpenAPIOperationExecutor} emits.
 * @public
 */
export type OpenAPIOperationEvent =
  | OpenAPIOperationNormalizeStartEvent
  | OpenAPIOperationNormalizeSettledEvent
  | OpenAPIOperationAssembledEvent;

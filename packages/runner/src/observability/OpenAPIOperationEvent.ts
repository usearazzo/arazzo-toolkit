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
export interface OperationNormalizeStartEvent extends OpenAPIOperationEventBase {
  readonly type: 'operation-normalize-start';
}

/**
 * The operation was normalized.
 * @public
 */
export interface OperationNormalizeSettledEvent extends OpenAPIOperationEventBase {
  readonly type: 'operation-normalize-settled';
}

/**
 * The normalized operation was assembled into the OpenAPI document the
 * request is built from.
 * @public
 */
export interface OperationAssembledEvent extends OpenAPIOperationEventBase {
  readonly type: 'operation-assembled';
}

/**
 * An event the {@link OpenAPIOperationExecutor} emits.
 * @public
 */
export type OpenAPIOperationEvent =
  OperationNormalizeStartEvent | OperationNormalizeSettledEvent | OperationAssembledEvent;

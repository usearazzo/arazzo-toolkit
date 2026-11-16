import type { RequestContext } from '../executor/OpenAPIOperationExecutor.ts';
import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The fields every {@link OpenAPIOperationEvent} carries: the operation, and
 * the step it runs for, in the same shape a {@link RequestInterceptor}
 * receives them.
 * @public
 */
export interface OpenAPIOperationEventBase extends ArazzoRunnerEventBase, RequestContext {
  readonly level: 'debug';
  /**
   * The `runId` of the {@link WorkflowExecutor.execute} call the operation
   * runs for, from the execute options. Absent when the executor is used
   * without one.
   */
  readonly runId?: string;
}

/**
 * A step's `operationId` or `operationPath` was resolved to an operation.
 * Emitted by the {@link StepExecutor}, once per attempt. The declared
 * `operationId` is not read yet at this point, so `operation` carries none.
 * @public
 */
export interface OperationLocatedEvent extends OpenAPIOperationEventBase {
  readonly type: 'operation-located';
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
 * An event the {@link StepExecutor} or {@link OpenAPIOperationExecutor} emits.
 * @public
 */
export type OpenAPIOperationEvent =
  | OperationLocatedEvent
  | OperationNormalizeStartEvent
  | OperationNormalizeSettledEvent
  | OperationAssembledEvent;

import type { SelectedAction } from '../action/ActionResolver.ts';
import type { CriterionEvaluationRecord } from '../executor/StepExecutor.ts';
import type { WorkflowCallVia } from '../executor/WorkflowCallStack.ts';
import type { StepTransition } from '../executor/StepTransitionInterpreter.ts';
import type {
  RetryReferenceRecord,
  WorkflowExecutionResult,
} from '../executor/WorkflowExecutor.ts';
import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The fields every {@link WorkflowExecutionEvent} carries.
 * @public
 */
export interface WorkflowExecutionEventBase extends ArazzoRunnerEventBase {
  /**
   * A random id of the {@link WorkflowExecutor.execute} call the event
   * belongs to. Every workflow, dependency and step of one call shares it, so
   * the events of concurrent calls, or of runs in different processes, can be
   * told apart. The operation events of the call carry it too.
   */
  readonly runId: string;
  /**
   * The bare id of the workflow in progress when the event fired. For a
   * `dependency-*` event, this is the dependent workflow, not the dependency.
   */
  readonly workflowId: string;
  /**
   * The chain of workflows in progress, outermost first, this one included.
   * Uses the same form as `ExecutionError.path`: bare ids for workflows of
   * the entry document, `{documentURI}#{workflowId}` for workflows of other
   * documents.
   */
  readonly path: readonly string[];
}

/**
 * The fields every step-scoped {@link WorkflowExecutionEvent} carries.
 * @public
 */
export interface WorkflowExecutionStepEventBase extends WorkflowExecutionEventBase {
  readonly stepId: string;
}

/**
 * A workflow invocation began, after its definition was checked and before
 * its `dependsOn` prerequisites and steps run.
 * @public
 */
export interface WorkflowStartEvent extends WorkflowExecutionEventBase {
  readonly type: 'workflow-start';
  readonly level: 'info';
  /**
   * How the workflow was reached. `root` is the workflow named in `execute`,
   * `step` is a sub-workflow step, `dependsOn` is a prerequisite, `retry` is
   * a `retry` action's `workflowId` reference, and `goto` is a one-way
   * transfer.
   */
  readonly via: WorkflowCallVia;
}

/**
 * A workflow invocation produced its result. The fields repeat the
 * {@link WorkflowExecutionResult} fields of the same name.
 * @public
 */
export interface WorkflowSettledEvent extends WorkflowExecutionEventBase {
  readonly type: 'workflow-settled';
  readonly level: 'info';
  readonly status: WorkflowExecutionResult['status'];
  readonly settledStatus: WorkflowExecutionResult['settledStatus'];
  readonly outputs: WorkflowExecutionResult['outputs'];
}

/**
 * The workflow a `dependency-*` event is about.
 * @public
 */
export interface WorkflowExecutionDependency {
  /**
   * The `dependsOn` entry as written: a bare workflowId, or a
   * `$sourceDescriptions.{name}.{workflowId}` expression.
   */
  readonly reference: string;
  /**
   * The bare id of the workflow the entry resolved to.
   */
  readonly workflowId: string;
  /**
   * The canonical URI of the Arazzo document that defines it.
   */
  readonly documentURI: string;
}

/**
 * A `dependsOn` prerequisite is about to be satisfied: either run, or found
 * already completed earlier in the same run.
 * @public
 */
export interface DependencyStartEvent extends WorkflowExecutionEventBase {
  readonly type: 'dependency-start';
  readonly level: 'info';
  readonly dependency: WorkflowExecutionDependency;
}

/**
 * A `dependsOn` prerequisite was satisfied, or failed.
 * @public
 */
export interface DependencySettledEvent extends WorkflowExecutionEventBase {
  readonly type: 'dependency-settled';
  readonly level: 'info';
  readonly dependency: WorkflowExecutionDependency;
  /**
   * Whether the prerequisite had already completed earlier in this run and was
   * not run again. When it is `true`, no workflow events of its own precede
   * this event.
   */
  readonly memoized: boolean;
  readonly settledStatus: WorkflowExecutionResult['settledStatus'];
}

/**
 * A step began. Its attempts follow it.
 * @public
 */
export interface StepStartEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'step-start';
  readonly level: 'info';
}

/**
 * One attempt at a step began, after it was charged to the step budget.
 * @public
 */
export interface StepAttemptEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'step-attempt';
  readonly level: 'info';
  /**
   * The attempt number, starting at 1. Each `retry` increments it. The
   * attempt a `retry` reference makes at another step is that reference's
   * own, so it is always 1, under the referenced step's `stepId`.
   */
  readonly attempt: number;
}

/**
 * One criterion was evaluated during an attempt. Fired after the attempt's
 * request (or sub-workflow run), in list order, success criteria first.
 * @public
 */
export interface CriterionEvaluatedEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'criterion-evaluated';
  readonly level: 'info';
  readonly attempt: number;
  /**
   * `success` for one of the step's `successCriteria`, `action` for a
   * criterion of an `onSuccess` / `onFailure` action the attempt considered.
   */
  readonly kind: 'success' | 'action';
  readonly criterion: CriterionEvaluationRecord;
}

/**
 * The action an attempt resolved to. Fired once for every attempt: with the
 * `retry` action that re-runs the step, or, for the last attempt, with the
 * step's terminal action.
 * @public
 */
export interface ActionSelectedEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'action-selected';
  readonly level: 'info';
  readonly attempt: number;
  /**
   * The selected action. `undefined` when none matched, so the step takes the
   * default path: the next step on success, a break on failure. It is the
   * document's own element, shared with the trace: read it, never change it.
   */
  readonly action: SelectedAction | undefined;
  /**
   * What the run does next because of it, as plain data: `retry` re-runs the
   * step, and the rest are the step's terminal transition — `next`, `goto` a
   * step, `transfer` to a workflow, `end`, or `break`. With no `action`, it is
   * the default path: `next` on success, `break` on failure.
   */
  readonly transition: StepTransition | { readonly kind: 'retry' };
}

/**
 * The run is about to wait out a `retry` action's `retryAfter` before the
 * step's next attempt. Fired only for a positive delay.
 * @public
 */
export interface RetryWaitEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'retry-wait';
  readonly level: 'info';
  readonly attempt: number;
  readonly delayMs: number;
}

/**
 * A `retry` action's `stepId` / `workflowId` reference is about to run.
 * @public
 */
export interface RetryReferenceStartEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'retry-reference-start';
  readonly level: 'info';
  readonly attempt: number;
  readonly kind: RetryReferenceRecord['kind'];
  readonly id: RetryReferenceRecord['id'];
}

/**
 * A `retry` action's reference completed.
 * @public
 */
export interface RetryReferenceSettledEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'retry-reference-settled';
  readonly level: 'info';
  readonly attempt: number;
  readonly kind: RetryReferenceRecord['kind'];
  readonly id: RetryReferenceRecord['id'];
  readonly successful: RetryReferenceRecord['successful'];
}

/**
 * A step settled: its retries are done and its terminal action is selected.
 * @public
 */
export interface StepSettledEvent extends WorkflowExecutionStepEventBase {
  readonly type: 'step-settled';
  readonly level: 'info';
  readonly successful: boolean;
  readonly attempts: number;
}

/**
 * The workflow is being normalized before its first run in this `execute`
 * call: dereferenced (which may fetch externally referenced documents), with
 * its parameters and actions inherited into its steps. A workflow already
 * normalized earlier in the same call emits nothing.
 * @public
 */
export interface WorkflowNormalizeStartEvent extends WorkflowExecutionEventBase {
  readonly type: 'workflow-normalize-start';
  readonly level: 'debug';
}

/**
 * The workflow was normalized.
 * @public
 */
export interface WorkflowNormalizeSettledEvent extends WorkflowExecutionEventBase {
  readonly type: 'workflow-normalize-settled';
  readonly level: 'debug';
}

/**
 * An event the {@link WorkflowExecutor} emits, discriminated by `type`.
 *
 * The `info` events fire at the boundaries the executor records in its
 * {@link WorkflowExecutionResult} trace, plus the criterion and action
 * decisions behind every step outcome, so folding a run's events rebuilds its
 * trace. A `*-start` / `*-settled` pair of a workflow or step is stamped with
 * the clock readings its `durationMs` is computed from: the two timestamps
 * differ by exactly that `durationMs`.
 *
 * A run that throws (an authoring error, a cancellation, a throwing observer)
 * leaves the workflows and steps it unwinds through without a settled event;
 * the rejection of `execute` is the signal.
 * @public
 */
export type WorkflowExecutionEvent =
  | WorkflowStartEvent
  | WorkflowSettledEvent
  | WorkflowNormalizeStartEvent
  | WorkflowNormalizeSettledEvent
  | DependencyStartEvent
  | DependencySettledEvent
  | StepStartEvent
  | StepAttemptEvent
  | CriterionEvaluatedEvent
  | ActionSelectedEvent
  | RetryWaitEvent
  | RetryReferenceStartEvent
  | RetryReferenceSettledEvent
  | StepSettledEvent;

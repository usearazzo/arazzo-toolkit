import type { ApiDOMErrorOptions } from '@speclynx/apidom-error';

import ArazzoRunnerError from './ArazzoRunnerError.ts';

/**
 * Carries a `reason`, one of the class's static reason fields.
 *
 * Every static on this class is a reason: {@link ExecutionErrorReason} is
 * derived from the class's own statics, so a non-reason static would join the
 * union.
 * @public
 */
class ExecutionError extends ArazzoRunnerError {
  /** The run was cancelled through its `AbortSignal`; the signal's reason is the `cause`. */
  static readonly Aborted = 'aborted' as const;
  /** A step or a `goto`/`retry` action declares more than one mutually exclusive target. */
  static readonly AmbiguousTarget = 'ambiguous-target' as const;
  /** The `dependsOn` edges alone form a cycle between workflows. */
  static readonly DependsOnCycle = 'dependsOn-cycle' as const;
  /** A `goto` action declares neither a `stepId` nor a `workflowId`. */
  static readonly GotoTargetMissing = 'goto-target-missing' as const;
  /** A `goto` action's `stepId` names no step in the workflow. */
  static readonly GotoTargetNotFound = 'goto-target-not-found' as const;
  /** An `operationId` or `operationPath` is not a valid operation reference. */
  static readonly InvalidOperationReference = 'invalid-operation-reference' as const;
  /** A `workflowId` is not a valid `$sourceDescriptions.{name}.{workflowId}` expression. */
  static readonly InvalidWorkflowReference = 'invalid-workflow-reference' as const;
  /** A workflow's `dependsOn` is not a list or holds a non-string entry. */
  static readonly MalformedDependsOn = 'malformed-dependsOn' as const;
  /** A workflow's `steps` is not a list or holds an entry that is not a Step Object. */
  static readonly MalformedSteps = 'malformed-steps' as const;
  /** A step run as an operation declares neither an `operationId` nor an `operationPath`. */
  static readonly MissingOperation = 'missing-operation' as const;
  /** An operation reference locates no operation in its OpenAPI source description. */
  static readonly OperationNotFound = 'operation-not-found' as const;
  /** A `retry` action references a step or workflow, but no run reference was given to run it. */
  static readonly RetryReferenceUnsupported = 'retry-reference-unsupported' as const;
  /** A `retry` action's `stepId` names no step in the workflow. */
  static readonly RetryTargetNotFound = 'retry-target-not-found' as const;
  /** A workflow reference names a source description that is not an Arazzo document. */
  static readonly SourceDescriptionNotArazzo = 'source-description-not-arazzo' as const;
  /** A reference names a source description the Arazzo document does not define. */
  static readonly SourceDescriptionNotFound = 'source-description-not-found' as const;
  /** An operation reference names a source description that is not an OpenAPI document. */
  static readonly SourceDescriptionNotOpenAPI = 'source-description-not-openapi' as const;
  /** A workflow exceeded its budget of step attempts. */
  static readonly StepBudget = 'step-budget' as const;
  /** An action declares a `type` other than `end`, `goto` or `retry`. */
  static readonly UnknownActionType = 'unknown-action-type' as const;
  /** `execute` received an option it does not know. */
  static readonly UnknownExecuteOption = 'unknown-execute-option' as const;
  /** A step produced a transition the workflow executor does not recognize. */
  static readonly UnknownTransitionKind = 'unknown-transition-kind' as const;
  /** A sub-workflow call (alone or together with `dependsOn`) forms a cycle between workflows. */
  static readonly WorkflowCycle = 'workflow-cycle' as const;
  /** Workflows nest deeper than the configured limit. */
  static readonly WorkflowDepth = 'workflow-depth' as const;
  /** A workflow reference names a workflow the Arazzo document does not define. */
  static readonly WorkflowNotFound = 'workflow-not-found' as const;
  /** A step that targets a workflow was handed to the step executor, which runs operations only. */
  static readonly WorkflowStep = 'workflow-step' as const;

  declare readonly stepId?: string;
  declare readonly workflowId?: string;
  declare readonly reason?: ExecutionErrorReason;
  /**
   * The chain of workflowIds the error concerns — the loop A → B → A for a
   * cycle, or the call chain in progress when a budget ran out.
   */
  declare readonly path?: readonly string[];

  constructor(
    message?: string,
    options?: ApiDOMErrorOptions & { readonly reason?: ExecutionErrorReason },
  ) {
    super(message, options);
  }
}

/**
 * One of the reasons an {@link ExecutionError} carries: an `ExecutionError`
 * static such as `ExecutionError.OperationNotFound`.
 * @public
 */
export type ExecutionErrorReason = (typeof ExecutionError)[Exclude<
  keyof typeof ExecutionError,
  keyof typeof ArazzoRunnerError | 'prototype'
>];

export default ExecutionError;

import ExecutionError from '../errors/ExecutionError.ts';

/**
 * Where a run was when it observed the caller's abort — carried into the error
 * so both the message and its structured fields name the boundary the run
 * stopped at. Both names are optional because the observers sit at different
 * depths: the workflow executor knows the workflow and (between attempts) the
 * step, while a {@link StepExecutor} used on its own knows only the step.
 * @internal
 */
export interface AbortContext {
  readonly workflowId?: string;
  readonly stepId?: string;
  /**
   * The chain of workflows in progress, reported as {@link ExecutionError.path}
   * — the leaf that happened to notice the abort is rarely the workflow the
   * caller named.
   *
   * Taken as the stack rather than as its `path` because that getter rebuilds
   * an array per access and this check sits in the per-attempt loop: passing
   * the stack keeps the common, not-aborted path free of it.
   */
  readonly callStack?: { readonly path: readonly string[] };
}

/**
 * Reads the `AbortSignal` a caller put in the opaque execute options bag, or
 * `undefined` when there is none.
 *
 * Duck-typed rather than `instanceof AbortSignal`: the bag is the caller's, and
 * a signal made in another realm (a worker, a test harness, a polyfill) must
 * still cancel the run.
 * @internal
 */
export const readAbortSignal = (options: Record<string, unknown>): AbortSignal | undefined => {
  const signal = options.signal;
  if (typeof signal !== 'object' || signal === null) return undefined;
  return typeof (signal as AbortSignal).aborted === 'boolean' ? (signal as AbortSignal) : undefined;
};

/**
 * Throws `reason: 'aborted'` when the caller has cancelled the run, and does
 * nothing otherwise.
 *
 * Cancellation throws rather than resolving as a `failed` result because it is
 * not a workflow outcome: nothing was judged by `successCriteria`, no failure
 * action was consulted, and the steps that did not run were not *decided*
 * against. A result would be indistinguishable from the API having answered.
 * The signal's own `reason` travels as the error's `cause`, so a caller that
 * aborted with a meaningful value keeps it.
 * @internal
 */
export const throwIfAborted = (signal: AbortSignal | undefined, context: AbortContext): void => {
  if (signal?.aborted !== true) return;

  const { workflowId, stepId, callStack } = context;
  const where = [
    stepId === undefined ? undefined : `step "${stepId}"`,
    workflowId === undefined ? undefined : `workflow "${workflowId}"`,
  ]
    .filter((part) => part !== undefined)
    .join(' in ');

  throw new ExecutionError(`run aborted before ${where}`, {
    workflowId,
    stepId,
    reason: 'aborted',
    path: callStack?.path,
    cause: signal.reason,
  });
};

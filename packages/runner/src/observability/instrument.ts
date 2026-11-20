import type { WorkflowCallVia } from '../executor/WorkflowCallStack.ts';
import type { DocumentLocation } from '../document/APIDocument.ts';
import type { ArazzoRunnerEvent, ArazzoRunnerObserver } from './ArazzoRunnerEvent.ts';

/**
 * A workflow invocation an {@link InstrumentationWrap} runs around: its
 * `workflow:start`, its steps and its `workflow:settled`.
 * @public
 */
export interface InstrumentedWorkflow {
  readonly kind: 'workflow';
  readonly runId: string;
  readonly workflowId: string;
  readonly path: readonly string[];
  readonly via: WorkflowCallVia;
  readonly location: DocumentLocation;
}

/**
 * A step an {@link InstrumentationWrap} runs around: its `step:start`, its
 * attempts and requests, and its `step:settled`.
 * @public
 */
export interface InstrumentedStep {
  readonly kind: 'step';
  readonly runId: string;
  readonly workflowId: string;
  readonly path: readonly string[];
  readonly stepId: string;
  readonly location: DocumentLocation;
}

/**
 * What an {@link InstrumentationWrap} runs around.
 * @public
 */
export type InstrumentedOperation = InstrumentedWorkflow | InstrumentedStep;

/**
 * Runs around each workflow invocation and each step, so what `run` does
 * happens inside it: in the active context of a span it opened, for one. It
 * must call `run` once and settle once `run` settles. What it resolves or
 * rejects with does not change the run: the run's own outcome stands, and the
 * operation's settled event says what it was.
 * @public
 */
export type InstrumentationWrap = (
  operation: InstrumentedOperation,
  run: () => Promise<void>,
) => Promise<void>;

/**
 * Hooks that apply to every runner in the process, on top of the observer
 * each was given.
 * @public
 */
export interface InstrumentationHooks {
  /**
   * Receives every event of every building block, after the block's own
   * observer, under the same rules: synchronously, never awaited, and a throw
   * aborts what emitted it. Events carry what the run saw, credentials
   * included.
   */
  readonly observer?: ArazzoRunnerObserver;
  /** Runs around each workflow invocation and each step. */
  readonly wrap?: InstrumentationWrap;
}

interface Registry {
  readonly hooks: InstrumentationHooks[];
}

// on globalThis, so the ESM and CommonJS builds of the runner, or two copies
// of it, share one registry
const KEY = Symbol.for('@usearazzo/runner/instrumentation');

const registry = (): Registry => {
  const scope = globalThis as { [KEY]?: Registry };
  scope[KEY] ??= { hooks: [] };
  return scope[KEY];
};

/**
 * Applies `hooks` to every runner in the process, until the returned
 * function removes them: the seam process-wide tooling, such as the
 * OpenTelemetry instrumentation, is built on. A run already in progress
 * picks hooks up at its next event or operation. Hooks apply in the order
 * they were added, the first wrap outermost.
 * @public
 */
const instrument = (hooks: InstrumentationHooks): (() => void) => {
  const { hooks: registered } = registry();
  registered.push(hooks);
  return () => {
    const index = registered.indexOf(hooks);
    if (index !== -1) registered.splice(index, 1);
  };
};

/**
 * Whether any process-wide observer is registered.
 * @internal
 */
export const isInstrumented = (): boolean => registry().hooks.some((hooks) => hooks.observer);

/**
 * Hands the event to every process-wide observer.
 * @internal
 */
export const notify = (event: ArazzoRunnerEvent): void => {
  for (const { observer } of registry().hooks) observer?.(event);
};

/**
 * Runs `work` inside every registered wrap, returning what `work` resolves
 * to or rejecting with what it rejects with, whatever a wrap settles with. A
 * wrap that throws before running `work` aborts it; one that throws after is
 * ignored.
 * @internal
 */
export const traced = async <T>(
  operation: InstrumentedOperation,
  work: () => Promise<T>,
): Promise<T> => {
  const wraps = registry().hooks.flatMap(({ wrap }) => (wrap === undefined ? [] : [wrap]));
  if (wraps.length === 0) return work();

  let outcome: { readonly value: T } | { readonly error: unknown } | undefined;
  let running: Promise<void> | undefined;
  // once, however many times a wrap calls it
  const innermost = (): Promise<void> =>
    (running ??= (async () => {
      try {
        outcome = { value: await work() };
      } catch (error: unknown) {
        outcome = { error };
        throw error;
      }
    })());
  const run = wraps.reduceRight<() => Promise<void>>(
    (next, wrap) => () => wrap(operation, next),
    innermost,
  );

  try {
    await run();
  } catch (error: unknown) {
    if (outcome === undefined) throw error;
  }
  if (outcome === undefined) {
    throw new TypeError(`an instrumentation wrap settled without running the ${operation.kind}`);
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
};

export default instrument;

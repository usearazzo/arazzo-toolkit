import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isObjectElement, isStringElement } from '@speclynx/apidom-datamodel';
import {
  isStepElement,
  type WorkflowElement,
  type StepElement,
  type FailureActionElement,
} from '@speclynx/apidom-ns-arazzo-1';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import type DocumentRegistry from '../registry/DocumentRegistry.ts';
import type { WorkflowId } from '../document/ArazzoWorkflowIndex.ts';
import type {
  RuntimeExpressionContext,
  RuntimeExpressionWorkflowContext,
} from '../expression/RuntimeExpressionContext.ts';
import RuntimeExpressionEvaluator from '../expression/RuntimeExpressionEvaluator.ts';
import ArazzoWorkflowExtractor from '../extractor/ArazzoWorkflowExtractor.ts';
import ArazzoWorkflowNormalizer from '../normalizer/ArazzoWorkflowNormalizer.ts';
import OutputResolver from '../resolver/OutputResolver.ts';
import WorkflowParameterResolver from '../resolver/WorkflowParameterResolver.ts';
import WorkflowExecutionState from '../state/WorkflowExecutionState.ts';
import StepExecutor, { STEP_TARGET_FIELDS } from './StepExecutor.ts';
import ArazzoWorkflowLocatorNormalizer, {
  type ArazzoWorkflowLocator,
} from './ArazzoWorkflowLocatorNormalizer.ts';
import StepRetryRunner, { type StepAttemptOutcome } from './StepRetryRunner.ts';
import WorkflowCallStack, { type WorkflowCallVia } from './WorkflowCallStack.ts';
import StepTransitionInterpreter, { actionTargets } from './StepTransitionInterpreter.ts';
import type { SelectedAction } from '../action/ActionResolver.ts';
import ExecutionError from '../errors/ExecutionError.ts';
import ResolverError from '../errors/ResolverError.ts';
import { readAbortSignal, throwIfAborted } from './abort.ts';

/**
 * Options for the WorkflowExecutor.
 * @public
 */
export interface WorkflowExecutorOptions {
  /**
   * The entry Arazzo document holding the workflows to run; also the
   * `$components` / `$sourceDescriptions` base for every entry-document
   * workflow's expressions. A workflow reached through a cross-document
   * reference resolves against its own document instead — the document
   * follows the invocation, not this option.
   */
  readonly document: ArazzoDocument;
  /**
   * The document registry holding the already-loaded source documents.
   */
  readonly registry: DocumentRegistry;
  /**
   * The per-step engine every step is delegated to. Build it with the client
   * factory (or a deterministic stub in tests) and pass it in — the workflow
   * executor is agnostic to how a step reaches the live API.
   */
  readonly stepExecutor: StepExecutor;
  /**
   * Upper bound on the number of step attempts in a single run — every attempt
   * of every step counts, including each `retry` and each entry into a
   * sub-workflow step. Guards against a runaway `goto` loop, a runaway `retry`,
   * and a runaway tree of sub-workflow calls alike. Defaults to 1000.
   *
   * The budget is shared by the whole call tree, not granted afresh per
   * workflow: a sub-workflow spinning on its own `goto` must not escape the
   * ceiling the caller set.
   */
  readonly maxSteps?: number;
  /**
   * Upper bound on how deeply workflows may nest — a workflow entered while
   * this many are already in progress throws `reason: 'workflow-depth'`.
   * Bounds *legitimate* (acyclic) nesting; a genuine cycle is caught earlier and
   * separately by `reason: 'workflow-cycle'`. Defaults to 32.
   *
   * The count includes the workflow `execute` was called with, so `1` permits
   * that workflow and forbids all nesting; a value below 1 leaves no room for
   * even the top-level run.
   */
  readonly maxWorkflowDepth?: number;
  /**
   * Delays for the given number of milliseconds — awaited between a step's retry
   * attempts (`retryAfter`). Injected so tests pass a no-op and real runs delay;
   * defaults to a real timer.
   *
   * The run's {@link WorkflowExecuteOptions.signal} is forwarded to it, so the
   * default timer stops waiting when the run is cancelled; an injected sleep
   * that ignores it merely postpones the cancellation until its wait ends.
   */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Reads the current time in milliseconds, used for the `durationMs` of each
   * run and step. Injected so tests assert exact durations; defaults to
   * `performance.now`, which is monotonic — `Date.now` would yield a wrong or
   * negative duration if the system clock were adjusted mid-run.
   */
  readonly now?: () => number;
}

/**
 * Per-call options for {@link WorkflowExecutor.execute}.
 * @public
 */
export interface WorkflowExecuteOptions {
  /**
   * The workflow's inputs, read via `$inputs`.
   */
  readonly inputs?: Record<string, unknown>;
  /**
   * The opaque client-specific bag forwarded verbatim to every
   * {@link StepExecutor.execute} (e.g. a `server` to run against).
   */
  readonly executeOptions?: Record<string, unknown>;
  /**
   * Inputs for the workflows run implicitly to satisfy `dependsOn`, keyed by
   * the `dependsOn` entry as written — the bare workflowId for a
   * same-document dependency, the whole
   * `$sourceDescriptions.{name}.{workflowId}` expression for a
   * cross-document one; consulted for transitive dependencies too. A
   * dependency with no entry runs with no inputs.
   *
   * The Arazzo Specification gives `dependsOn` no input-mapping mechanism of its
   * own (unlike a sub-workflow *step*, which maps inputs through its
   * `parameters`), so this is the only channel by which a dependency that
   * requires inputs can receive them.
   */
  readonly dependencyInputs?: Record<string, Record<string, unknown>>;
  /**
   * Whether to run the workflows named by `dependsOn` before the workflow's own
   * steps. Defaults to `true`.
   *
   * Pass `false` to assert the dependencies were already satisfied out-of-band —
   * "MUST be completed before" does not mean *completed by this engine in this
   * run*, and re-running them may duplicate side effects. Opting out records no
   * `$workflows.{dependencyId}.outputs`, so expressions reading a dependency's
   * outputs then resolve to `undefined`.
   *
   * It applies to **the workflow named in this call only**. A sub-workflow it
   * calls still runs its own prerequisites: those are an implementation detail
   * the caller may not know exists, so skipping them on their behalf would run
   * that workflow against state nobody claimed to have prepared.
   */
  readonly runDependencies?: boolean;
  /**
   * Cancels the run. Observed before every step attempt — including each retry,
   * each sub-workflow step, and each `dependsOn` prerequisite — and during the
   * `retryAfter` waits between attempts, so an aborted run stops at the next
   * boundary rather than working its way to the end of the workflow.
   *
   * An aborted run throws {@link ExecutionError} with `reason: 'aborted'`,
   * naming the boundary it stopped at and carrying the signal's own `reason` as
   * the error's `cause`. It does not resolve as a `failed` result: cancellation
   * is not something the steps did, and the steps that never ran were not
   * decided against.
   *
   * The signal is also forwarded to the transport (through the same
   * `executeOptions` bag it may be passed in), so the request in flight when the
   * abort lands is cancelled rather than merely awaited. A `signal` passed in
   * that bag instead is observed here too — it cancels the run just as this
   * option does — and this option wins when both are given.
   */
  readonly signal?: AbortSignal;
}

/**
 * One run of a `retry` action's `stepId` / `workflowId` reference — "the
 * reference is executed and the context is returned, after which the current
 * step is retried". Fires once per firing of its action (i.e. once before every
 * attempt the action grants, not once for the whole retry chain).
 * @public
 */
export interface RetryReferenceRecord {
  /**
   * Which field the action carried: `stepId` runs one step of the current
   * workflow; `workflowId` runs another workflow to completion.
   */
  readonly kind: 'step' | 'workflow';
  /**
   * The referenced `stepId` or `workflowId`, as written — a cross-document
   * workflow reference stays in its
   * `$sourceDescriptions.{name}.{workflowId}` form.
   */
  readonly id: string;
  /**
   * Whether the reference completed successfully. For `kind: 'workflow'`, this
   * is whether the referenced run's transfer chain settled `status !== 'failed'`
   * — a reference to a workflow that transferred is judged by where control
   * ended up, not by the intermediate `'transferred'` status. Does not gate the
   * retry: the retry proceeds either way, since the spec speaks of the
   * reference's *completion*, not its success.
   */
  readonly successful: boolean;
  /**
   * The nested run, when the reference invoked a workflow — either directly
   * (`kind: 'workflow'`) or because the referenced step itself targets a
   * `workflowId` (`kind: 'step'`).
   */
  readonly subWorkflow?: WorkflowExecutionResult;
}

/**
 * The trace of a single step execution within a workflow run.
 * @public
 */
export interface StepRunRecord {
  readonly stepId: string;
  readonly successful: boolean;
  readonly action: SelectedAction | undefined;
  /**
   * How many times the step ran — 1 with no retries, more when a `retry` action
   * fired. The final `successful` / `action` reflect the last attempt.
   */
  readonly attempts: number;
  /**
   * Elapsed time the step took, covering every attempt and the `retryAfter`
   * waits between them. Measured on a monotonic clock by default, so it may be
   * fractional and is unaffected by system clock changes.
   */
  readonly durationMs: number;
  /**
   * The sub-workflow runs this step produced, in attempt order — present only on
   * a step targeting a `workflowId`.
   *
   * A list rather than a single result because a retried sub-workflow step runs
   * its sub-workflow once per attempt, and each run is a trace of its own; the
   * last entry is the run this record's `successful` / `action` describe.
   */
  readonly subWorkflows?: readonly WorkflowExecutionResult[];
  /**
   * The `retry` reference runs this step's attempts produced, in firing order —
   * present only when a `retry` failure action that fired carried a `stepId` /
   * `workflowId` reference. Kept separate from {@link StepRunRecord.subWorkflows}
   * because a reference is a repair the *retry* invokes, not the step's own
   * target.
   */
  readonly retryReferences?: readonly RetryReferenceRecord[];
}

/**
 * The outcome of executing a workflow.
 *
 * `status` is `completed` when the steps ran to the end of the list, `ended`
 * when an `end` action stopped the run early, `failed` when a step failed and no
 * matching `onFailure` action redirected it (the break-and-return default) — or
 * when a `dependsOn` workflow did not complete — and `transferred` when a `goto`
 * action handed control one-way to another workflow: this run's own steps stop
 * at that point, and its `outputs` declaration is never evaluated, since the run
 * never reaches its own end. See {@link WorkflowExecutionResult.settledStatus}
 * for the success/failure verdict a `'transferred'` result defers to.
 * @public
 */
export interface WorkflowExecutionResult {
  readonly workflowId: string;
  readonly outputs: Record<string, unknown>;
  readonly steps: readonly StepRunRecord[];
  readonly status: 'completed' | 'ended' | 'failed' | 'transferred';
  /**
   * Where this run's outcome actually settled: `status` itself when it isn't
   * `'transferred'`, otherwise the terminal, non-`'transferred'` status at the
   * end of the {@link WorkflowExecutionResult.transferredTo} chain — computed
   * once, eagerly, when this result is built, so it costs nothing to read and
   * nothing to forget.
   *
   * `status` alone is not a success/failure verdict: `'transferred'` records
   * *where* control went, not whether the run succeeded, so comparing it
   * directly against `'failed'` — the natural thing to write — silently
   * misses a failure buried in the chain. `settledStatus` is that comparison,
   * already made, always present (even when `status` isn't `'transferred'`,
   * where it simply repeats `status`): prefer `result.settledStatus ===
   * 'failed'` over `result.status === 'failed'` for "did this run succeed",
   * including on the top-level result {@link WorkflowExecutor.execute}
   * itself returns.
   */
  readonly settledStatus: 'completed' | 'ended' | 'failed';
  /**
   * Elapsed time the run took, including its dependencies, sub-workflows, and
   * retry waits — and, for a `'transferred'` run, the whole chain nested
   * under {@link WorkflowExecutionResult.transferredTo}, since running the
   * target is what this run's own time was spent on. Measured on a monotonic
   * clock by default, so it may be fractional and is unaffected by system
   * clock changes.
   */
  readonly durationMs: number;
  /**
   * The runs of the workflows named by `dependsOn`, in declaration order —
   * present only when the workflow declares dependencies and they were run.
   *
   * A dependency already completed earlier in the same run is not run again; its
   * one result is reported here for each dependent that declares it.
   */
  readonly dependencies?: readonly WorkflowExecutionResult[];
  /**
   * The target workflow's own run, present only when `status` is `transferred`.
   *
   * Nested rather than spliced in, like {@link WorkflowExecutionResult.dependencies}
   * — this run's `workflowId` stays the workflow that was called, not the one
   * control ended up in. If the target itself transfers onward, the chain is
   * reachable by following `transferredTo.transferredTo`, recursively; its own
   * `outputs` are the only place the transfer's actual output values live, since
   * this run's top-level `outputs` is always `{}`.
   */
  readonly transferredTo?: WorkflowExecutionResult;
}

/**
 * The result a transfer chain settled on: `result` itself when its `status`
 * isn't `'transferred'`, otherwise the terminal, non-`'transferred'` result at
 * the end of its `transferredTo` chain.
 *
 * For the success/failure verdict alone, prefer
 * {@link WorkflowExecutionResult.settledStatus} — every result already
 * carries it, computed eagerly, so no call is needed. Reach for this function
 * when the terminal result *itself* is wanted (its `outputs`, `steps`,
 * `workflowId`), not just where it landed. Iterative, not recursive: a
 * chain's length is bounded only by `maxWorkflowDepth`, and this must not add
 * a matching bound on call-stack depth.
 * @public
 */
export function settledResult(result: WorkflowExecutionResult): WorkflowExecutionResult {
  let current = result;
  while (current.transferredTo !== undefined) {
    current = current.transferredTo;
  }
  return current;
}

/**
 * How a `#run` invocation ended, handed to `#result` to assemble the final
 * {@link WorkflowExecutionResult} from.
 *
 * A discriminated union rather than a `status` string plus a separately-set
 * `transferredTo` — the shape this replaced, where nothing but convention
 * kept the two in sync. Here, `status: 'transferred'` with no
 * `transferredTo` (or the reverse) is not a state a caller of `#result` can
 * construct, not merely one they are expected not to.
 * @internal
 */
type RunOutcome =
  | { readonly kind: 'settled'; readonly status: 'completed' | 'ended' | 'failed' }
  | { readonly kind: 'transferred'; readonly transferredTo: WorkflowExecutionResult };

/**
 * One completed `dependsOn` run, remembered with the inputs it was actually
 * given — see {@link RunScope.dependencyRuns}.
 */
interface DependencyRun {
  readonly result: WorkflowExecutionResult;
  readonly inputs: Record<string, unknown>;
}

/**
 * The state shared by every workflow invocation of a single
 * {@link WorkflowExecutor.execute} call — the caller's per-run options plus the
 * two mutable ledgers that must span the whole call tree.
 */
interface RunScope {
  readonly executeOptions: Record<string, unknown>;
  readonly dependencyInputs: Record<string, Record<string, unknown>>;
  readonly runDependencies: boolean;
  /**
   * The caller's cancellation, checked at every boundary in the call tree.
   */
  readonly signal: AbortSignal | undefined;
  /**
   * Step attempts spent so far, across every workflow in the tree.
   */
  readonly budget: { spent: number };
  /**
   * The `dependsOn` workflows already completed in this run, keyed by
   * `{documentURI}#{workflowId}` — a dependency reached again (a diamond) is
   * satisfied from here rather than run twice. Qualified because two
   * documents may each define a workflow of one id, and a run of one must
   * not satisfy a precondition naming the other. Each entry carries the
   * inputs the run was actually given alongside its result: a later
   * dependent may spell the same dependency differently (the bare id inside
   * the owning document, the `$sourceDescriptions` expression outside it),
   * and its own `dependencyInputs` entry — keyed by that spelling — is not
   * what the memoized run received, so recording it under `$workflows` would
   * attribute inputs to a run that never got them.
   */
  readonly dependencyRuns: Map<string, DependencyRun>;
  /**
   * Workflows already extracted and normalized in this run, keyed by
   * `{documentURI}#{workflowId}`. Normalization dereferences the whole
   * workflow subtree, so a sub-workflow called from several places — or
   * retried — must not pay for it each time.
   */
  readonly workflows: Map<string, WorkflowElement>;
}

/**
 * One workflow invocation in progress: the values fixed for a single `#run` that
 * travel together into everything it delegates to.
 */
interface WorkflowInvocation {
  readonly workflowId: string;
  /**
   * The Arazzo document the workflow belongs to — the base its workflow
   * lookups, its steps' operations, and its `$components` /
   * `$sourceDescriptions` expressions all resolve against. Part of the
   * invocation rather than executor state: a cross-document reference makes
   * the next invocation's document a different one.
   */
  readonly document: ArazzoDocument;
  readonly state: WorkflowExecutionState;
  /**
   * The chain of workflows in progress, this one included — extended for each
   * workflow this invocation calls or depends on.
   */
  readonly callStack: WorkflowCallStack;
  /**
   * How this workflow was reached, which distinguishes the workflow the caller
   * named from the ones the run pulled in on its own.
   */
  readonly via: WorkflowCallVia;
}

/**
 * Executes an Arazzo workflow: the stateful loop that turns "run one step" into
 * "run a workflow".
 *
 * It iterates a workflow's steps in list order, delegating each to
 * {@link StepExecutor}, records the resolved step outputs into a
 * {@link WorkflowExecutionState} so later steps read `$steps.{id}.outputs.{name}`,
 * and interprets the {@link SelectedAction} the step executor selects but does
 * not act on — advancing to the next step, jumping via `goto`, transferring
 * one-way to another workflow via a `goto` naming a `workflowId`, or stopping on
 * `end` / the failure break-default. After the loop it resolves the workflow's
 * `outputs` against the final state — unless the run transferred, in which case
 * it never reaches its own end and `outputs` stays `{}`.
 *
 * A step targeting a `workflowId` is a sub-workflow call the executor runs
 * itself, recursively; the workflows named by `dependsOn` are run to completion
 * before the workflow's own steps. Both recurse through one call tree, guarded
 * by a shared step budget, a nesting-depth ceiling, and cycle detection. A
 * `goto`'s transfer joins the same call tree, entered via `'goto'`, but is not
 * charged against the step budget: it fires once per step evaluation, unlike a
 * retry reference, which can fire repeatedly from the same frame.
 *
 * State is created fresh per {@link WorkflowExecutor.execute} call — and per
 * workflow invocation within it — and owned here; the returned result is
 * read-only. Authoring errors (missing workflow, unknown `goto` target, a cycle,
 * budget overflow) throw {@link ExecutionError}, as does a run the caller
 * cancels through {@link WorkflowExecuteOptions.signal}; a step that
 * legitimately fails and breaks, or a dependency that fails, is a normal
 * `status: 'failed'` result, not a throw — the same split {@link StepExecutor}
 * draws.
 *
 * A workflow reference — a sub-workflow step's `workflowId`, a `dependsOn`
 * entry, a `retry` action's reference, a `goto`'s transfer — may also name a
 * workflow of another Arazzo document, as
 * `$sourceDescriptions.{name}.{workflowId}`. The run then follows that
 * document for the foreign workflow: its id lookups, its steps' operations,
 * and its expressions all resolve against the document that owns it, while
 * the `$workflows.{workflowId}` run state stays keyed by the bare id — the
 * only form the runtime-expression grammar can express.
 * @public
 */
class WorkflowExecutor {
  static readonly #DEFAULT_MAX_STEPS = 1000;
  static readonly #DEFAULT_MAX_WORKFLOW_DEPTH = 32;
  static readonly #DEFAULT_NOW = (): number => performance.now();
  static readonly #EXECUTE_OPTION_KEYS: ReadonlySet<string> = new Set([
    'inputs',
    'executeOptions',
    'dependencyInputs',
    'runDependencies',
    'signal',
  ]);

  readonly #document: ArazzoDocument;
  readonly #registry: DocumentRegistry;
  readonly #maxSteps: number;
  readonly #maxWorkflowDepth: number;
  readonly #now: () => number;
  readonly #extractor = new ArazzoWorkflowExtractor();
  readonly #normalizer = new ArazzoWorkflowNormalizer();
  readonly #outputResolver = new OutputResolver();
  readonly #parameterResolver = new WorkflowParameterResolver();
  readonly #stepExecutor: StepExecutor;
  readonly #retryRunner: StepRetryRunner;
  readonly #interpreter = new StepTransitionInterpreter();
  readonly #workflowLocatorNormalizer: ArazzoWorkflowLocatorNormalizer;

  constructor(options: WorkflowExecutorOptions) {
    this.#document = options.document;
    this.#registry = options.registry;
    this.#workflowLocatorNormalizer = new ArazzoWorkflowLocatorNormalizer(options.registry);
    this.#maxSteps = options.maxSteps ?? WorkflowExecutor.#DEFAULT_MAX_STEPS;
    this.#maxWorkflowDepth =
      options.maxWorkflowDepth ?? WorkflowExecutor.#DEFAULT_MAX_WORKFLOW_DEPTH;
    this.#now = options.now ?? WorkflowExecutor.#DEFAULT_NOW;
    this.#stepExecutor = options.stepExecutor;
    this.#retryRunner = new StepRetryRunner({ sleep: options.sleep });
  }

  /**
   * Runs the named workflow to completion, returning its outcome.
   *
   * The workflows the target names in `dependsOn` are run first (see
   * {@link WorkflowExecuteOptions.runDependencies}), then its own steps.
   *
   * All run-scoped state — the execution state, the step trace, the control-flow
   * position, the call stack, the step budget, and the completed-dependency
   * ledger — is local to this call, so concurrent `execute` calls on one executor
   * do not interfere.
   */
  async execute(
    workflowId: WorkflowId,
    options: WorkflowExecuteOptions = {},
  ): Promise<WorkflowExecutionResult> {
    this.#rejectUnknownOptions(options);

    // a signal in the opaque bag was the only channel before this option existed,
    // and it still reaches the transport. Absorbing it here is what makes it a
    // whole cancellation rather than half of one: read only at dispatch, it would
    // abort requests while the loop walked on through the remaining steps.
    const signal = options.signal ?? readAbortSignal(options.executeOptions ?? {});
    const scope: RunScope = {
      // the first-class signal is also spread into the opaque bag, because that
      // bag is how anything reaches the transport: the executor's own checks
      // stop the run at the next boundary, and this is what cancels the request
      // already in flight. Spread last, so it wins over one passed in the bag.
      executeOptions: { ...options.executeOptions, ...(signal === undefined ? {} : { signal }) },
      dependencyInputs: options.dependencyInputs ?? {},
      runDependencies: options.runDependencies ?? true,
      signal,
      budget: { spent: 0 },
      dependencyRuns: new Map(),
      workflows: new Map(),
    };
    return this.#run(
      { document: this.#document, workflowId },
      options.inputs ?? {},
      scope,
      new WorkflowCallStack({
        maxDepth: this.#maxWorkflowDepth,
        entryDocumentURI: this.#document.uri,
      }),
      'root',
    );
  }

  /**
   * Rejects an options bag carrying keys this method does not recognize.
   *
   * `execute` used to take `inputs` as its second positional argument, and that
   * bag is now the options object — so the old call reaches here as an object of
   * unrecognized keys. Left unchecked it would run with no inputs at all, and
   * every `$inputs.*` would resolve to `undefined` under lenient evaluation:
   * a completed run issuing wrong requests. A typo in an option name fails the
   * same silent way. Both are worth a loud error.
   */
  #rejectUnknownOptions(options: WorkflowExecuteOptions): void {
    const unknown = Object.keys(options).filter(
      (key) => !WorkflowExecutor.#EXECUTE_OPTION_KEYS.has(key),
    );
    if (unknown.length === 0) return;

    throw new ExecutionError(
      `execute received unknown option(s) ${unknown.join(', ')}; it takes (workflowId, { inputs, executeOptions, dependencyInputs, runDependencies, signal }) — workflow inputs go under "inputs"`,
      { reason: 'unknown-execute-option' },
    );
  }

  /**
   * Runs one workflow invocation — the recursive worker every entry point funnels
   * through: the public {@link WorkflowExecutor.execute}, a sub-workflow step,
   * and a `dependsOn` prerequisite alike, each entering the caller's call stack
   * with its own edge.
   */
  async #run(
    locator: ArazzoWorkflowLocator,
    inputs: Record<string, unknown>,
    scope: RunScope,
    callStack: WorkflowCallStack,
    via: WorkflowCallVia,
  ): Promise<WorkflowExecutionResult> {
    const startedAt = this.#now();
    const { workflowId } = locator;
    // entering yields a new stack rather than mutating the caller's, so leaving is
    // implicit — and a cycle or over-deep nesting throws here, before any of this
    // workflow's own work begins. The entry is identified by the owning
    // document's URI as well as the id, so a foreign document's reference
    // back into the entry document closes a detectable cycle, and two
    // documents' workflows sharing an id do not falsely form one.
    const nested = callStack.enter(workflowId, via, locator.document.uri);
    // the workflow boundary, checked in its own right and not only per step: a
    // run cancelled before any step — or between a prerequisite and the workflow
    // that needed it — must not go on to normalize and enter a workflow nobody
    // is waiting for.
    throwIfAborted(scope.signal, { workflowId, callStack: nested });

    const workflow = await this.#resolveWorkflow(locator, scope);
    const state = new WorkflowExecutionState({ inputs });
    const invocation: WorkflowInvocation = {
      workflowId,
      document: locator.document,
      state,
      callStack: nested,
      via,
    };

    // validated before any prerequisite runs: a malformed `steps` is an
    // authoring error, and discovering it only after the dependencies have
    // fired would mean live side effects on the way to a throw.
    const steps = this.#orderedSteps(workflow, workflowId);
    // same reasoning extends to `outputs`: a workflow that cannot possibly
    // produce them is unrunnable from the start, and only a shape check is
    // needed to know that — no run state is required for it. Checking now, not
    // at `#result` where it used to be resolved, means the throw lands before
    // the first request rather than after the last.
    this.#validateWorkflowOutputsShape(workflow, workflowId);

    const dependencies = await this.#runDependencies(workflow, invocation, scope);
    if (dependencies.some((dependency) => this.#settledFailed(dependency))) {
      // a declared prerequisite did not complete, so this workflow cannot be
      // processed. That is a runtime failure like any failing step — a `failed`
      // result carrying the dependency trace, not a throw — and none of its own
      // steps run. Unless the run was cancelled, in which case the prerequisite
      // did not fail on its own terms either.
      throwIfAborted(scope.signal, { workflowId, callStack: nested });
      return this.#result(
        invocation,
        workflow,
        [],
        { kind: 'settled', status: 'failed' },
        dependencies,
        startedAt,
      );
    }

    const trace: StepRunRecord[] = [];
    let index = 0;
    // named distinctly from each step's own `outcome` (a StepAttemptOutcome,
    // destructured fresh every iteration below) — the two are unrelated
    // values that happen to share a natural name.
    let runOutcome: RunOutcome = { kind: 'settled', status: 'completed' };

    stepLoop: while (index < steps.length) {
      const step = steps[index];
      const stepId = toValue(step.stepId) as string;
      const stepStartedAt = this.#now();
      // the sub-workflow runs this step produces — one per attempt, so a retried
      // sub-workflow step keeps every attempt's trace rather than only the last.
      const subWorkflows: WorkflowExecutionResult[] = [];
      // the retry reference runs this step's attempts produced, one per firing —
      // separate from `subWorkflows` because a reference belongs to the retry
      // that invoked it, not to the step's own target.
      const retryReferences: RetryReferenceRecord[] = [];
      const attempt = this.#chargedAttempt(
        this.#stepAttempt(step, stepId, invocation, scope, subWorkflows),
        invocation,
        scope,
        stepId,
      );

      // the retry runner settles any `retry` actions, so `action` is the terminal
      // action a retry chain resolved to and `attempts` is how many times the step
      // ran.
      const { outcome, action, attempts } = await this.#retryRunner.run(attempt, {
        stepId,
        workflowId,
        signal: scope.signal,
        runReference: this.#retryReference(steps, stepId, invocation, scope, retryReferences),
      });
      state.setStepOutputs(outcome.stepId, outcome.outputs);
      trace.push({
        stepId: outcome.stepId,
        successful: outcome.successful,
        action,
        attempts,
        durationMs: this.#now() - stepStartedAt,
        ...(subWorkflows.length > 0 ? { subWorkflows } : {}),
        ...(retryReferences.length > 0 ? { retryReferences } : {}),
      });

      const transition = this.#interpreter.interpret(action, outcome.successful, {
        workflowId,
        stepId,
      });
      switch (transition.kind) {
        case 'next':
          index += 1;
          break;
        case 'goto':
          index = this.#interpreter.indexOfStep(steps, transition.stepId, workflowId, {
            reason: 'goto-target-not-found',
            label: 'goto target',
          });
          break;
        case 'transfer': {
          // a one-way transfer: this run ends here, and the target's run is
          // nested rather than spliced into this one. Checked for cancellation
          // before running the target — same boundary convention as every
          // other nested call — ahead of the reference helper's own
          // resolution, so an aborted run reports `aborted` rather than
          // whatever resolving the target (a malformed reference, a missing
          // source) would have thrown.
          throwIfAborted(scope.signal, { workflowId, stepId, callStack: nested });
          const transferredTo = await this.#runReferencedWorkflow(
            transition.workflowId,
            stepId,
            invocation,
            scope,
            'goto',
          );
          runOutcome = { kind: 'transferred', transferredTo };
          break stepLoop;
        }
        case 'end':
          runOutcome = { kind: 'settled', status: 'ended' };
          break stepLoop;
        case 'break':
          runOutcome = { kind: 'settled', status: 'failed' };
          break stepLoop;
        default: {
          // exhaustiveness guard: a Transition kind added above without a case
          // here would otherwise fall through silently instead of failing
          // loudly — `transition` is provably `never` once every kind above
          // has its own case, which TypeScript checks at compile time.
          const unreachable: never = transition;
          throw new ExecutionError(
            `step "${stepId}" in workflow "${workflowId}" produced an unrecognized transition ${JSON.stringify(unreachable)}`,
            { workflowId, stepId, reason: 'unknown-transition-kind' },
          );
        }
      }
    }

    // the closing boundary. Nothing follows the last step, so without a check
    // here a run abandoned while that step was in flight would resolve as though
    // the caller had waited for it — and whether it did would depend on the
    // transport, since one honoring the signal fails the request instead.
    // Cancellation must not be the one outcome that reads differently for the
    // last step than for every step before it.
    throwIfAborted(scope.signal, { workflowId, callStack: nested });

    return this.#result(invocation, workflow, trace, runOutcome, dependencies, startedAt);
  }

  /**
   * Assembles the run's result from how it ended, resolving the workflow's
   * `outputs` against the final state (unless it transferred) and stamping
   * the elapsed time. `dependencies` is reported only when the workflow
   * actually had some.
   *
   * `outcome` is the single source every derived field reads from — `status`,
   * `settledStatus`, whether `outputs` gets resolved at all, whether
   * `transferredTo` is present — so there is no second place any of them
   * could drift from it. A `'transferred'` run never reaches its own end, so
   * its `outputs` declaration is never evaluated — `{}` is the only honest
   * value; the target's own outputs live at `transferredTo.outputs`. Skipping
   * resolution loses no validation:
   * {@link WorkflowExecutor.#validateWorkflowOutputsShape} already checked
   * the shape up front, independent of resolving it.
   */
  #result(
    invocation: WorkflowInvocation,
    workflow: WorkflowElement,
    steps: readonly StepRunRecord[],
    outcome: RunOutcome,
    dependencies: readonly WorkflowExecutionResult[],
    startedAt: number,
  ): WorkflowExecutionResult {
    const shared = {
      workflowId: invocation.workflowId,
      steps,
      durationMs: this.#now() - startedAt,
      ...(dependencies.length > 0 ? { dependencies } : {}),
    };
    if (outcome.kind === 'transferred') {
      return {
        ...shared,
        outputs: {},
        status: 'transferred',
        // computed once, here, rather than left for a caller to chase via
        // `settledResult` — `transferredTo` already carries its own
        // `settledStatus`, itself computed the same way when it was built,
        // so this is O(1) per hop rather than a walk of the whole chain.
        settledStatus: outcome.transferredTo.settledStatus,
        transferredTo: outcome.transferredTo,
      };
    }
    return {
      ...shared,
      outputs: this.#resolveWorkflowOutputs(workflow, invocation),
      status: outcome.status,
      settledStatus: outcome.status,
    };
  }

  /**
   * Whether a nested run's transfer chain settled on `'failed'` — reading
   * {@link WorkflowExecutionResult.settledStatus} directly, which every
   * result already carries, rather than walking `transferredTo` itself.
   */
  #settledFailed(result: WorkflowExecutionResult): boolean {
    return result.settledStatus === 'failed';
  }

  /**
   * Charges one step attempt to the run-wide budget, throwing when it is spent.
   *
   * This is what bounds a runaway `retry`, a runaway `goto` loop, and a runaway
   * tree of sub-workflow calls alike. The budget spans the whole call tree, so a
   * sub-workflow cannot start afresh; the error carries the chain in progress,
   * because the leaf that happened to spend the last unit is rarely the workflow
   * that is looping.
   */
  #chargeBudget(scope: RunScope, invocation: WorkflowInvocation, stepId: string): void {
    if (++scope.budget.spent <= this.#maxSteps) return;

    throw new ExecutionError(
      `workflow "${invocation.workflowId}" exceeded its budget of ${this.#maxSteps} step attempts (a goto loop, excessive retries, or runaway sub-workflow calls)`,
      {
        workflowId: invocation.workflowId,
        stepId,
        reason: 'step-budget',
        path: invocation.callStack.path,
      },
    );
  }

  /**
   * Wraps a step-attempt thunk with the checks every attempt needs at its
   * boundary: charge the run-wide budget, and check for cancellation both
   * before the attempt runs and, if it throws, again on the way out — a
   * cancellation noticed inside the attempt (StepExecutor is handed no
   * workflow or call chain) is re-raised here with both attached, which keeps
   * an abort surfacing mid-request as informative as one caught between two
   * attempts.
   *
   * Shared by the step's own attempts and a `retry` action's `stepId`
   * reference, which is itself one more step attempt against this same run.
   */
  #chargedAttempt(
    runAttempt: () => Promise<StepAttemptOutcome>,
    invocation: WorkflowInvocation,
    scope: RunScope,
    stepId: string,
  ): () => Promise<StepAttemptOutcome> {
    const { workflowId, callStack } = invocation;
    return async () => {
      throwIfAborted(scope.signal, { workflowId, stepId, callStack });
      this.#chargeBudget(scope, invocation, stepId);
      try {
        return await runAttempt();
      } catch (error: unknown) {
        throwIfAborted(scope.signal, { workflowId, stepId, callStack });
        throw error;
      }
    };
  }

  /**
   * Builds the {@link StepRetryRunContext.runReference} callback a `retry`
   * action's `stepId` / `workflowId` reference is run through.
   *
   * The runner that calls this back owns *when* — once per firing, after the
   * `retryAfter` wait, before the step is re-run; this owns *how*. A retry
   * action naming both fields is malformed — the same mutual-exclusivity
   * `#subWorkflowId` enforces for a step's own target — rejected before either
   * branch below runs, rather than silently preferring one.
   *
   * - a `workflowId` reference runs that workflow to completion through
   *   `#run`, on the same shared budget, call stack, and cycle/depth guards
   *   as a sub-workflow step — entered via `'retry'` so a loop closed through
   *   it is named a call cycle, not a dependency one, and charged one unit
   *   for entering the reference itself, matching the "1 for the step itself
   *   plus whatever its sub-run spends" convention a sub-workflow step
   *   already follows (without it, a reference to a workflow with few or no
   *   steps of its own would cost nothing to fire). It runs with no inputs:
   *   the specification gives a retry reference no input-mapping mechanism
   *   of its own (the same gap `dependsOn` has), and `{}` is the only
   *   spec-honest fallback — see issue `#62`. Its outputs are recorded via
   *   `state.setWorkflow`, which *is* "context transfers back" — but its
   *   `inputs` are preserved rather than overwritten with `{}` when this
   *   workflowId was already recorded (by an earlier `dependsOn` prerequisite
   *   or sub-workflow step sharing the id): this call's own lack of a real
   *   inputs value must not erase one a different, better-informed caller
   *   already gave.
   * - a `stepId` reference must name a step of the current workflow (checked
   *   lazily, at fire time, via the same lookup a `goto` target uses) and
   *   runs as one more attempt at that step, through
   *   {@link WorkflowExecutor.#stepAttempt} and
   *   {@link WorkflowExecutor.#chargedAttempt} — so a step referencing a
   *   `workflowId` itself is handled the normal way, and the reference counts
   *   against the same budget. Its outputs are recorded via
   *   `state.setStepOutputs` — that recording *is* "context transfers back".
   *
   * Neither kind's own `onSuccess` / `onFailure` (or, for a step reference, its
   * `successCriteria`-derived action) is acted on: "context transfers back upon
   * completion" makes a reference a call, not a redirect, and a failed
   * reference does not break the retry chain — the spec speaks of the
   * reference's *completion*, not its success, and a retry that turns out
   * futile is bounded by `retryLimit` regardless.
   */
  #retryReference(
    steps: readonly StepElement[],
    stepId: string,
    invocation: WorkflowInvocation,
    scope: RunScope,
    retryReferences: RetryReferenceRecord[],
  ): (action: FailureActionElement) => Promise<void> {
    const { workflowId, state, callStack } = invocation;

    return async (action: FailureActionElement): Promise<void> => {
      throwIfAborted(scope.signal, { workflowId, stepId, callStack });

      const { hasStepId, hasWorkflowId } = actionTargets(action);
      if (hasWorkflowId && hasStepId) {
        throw new ExecutionError(
          `retry action on step "${stepId}" in workflow "${workflowId}" declares both a stepId and a workflowId (mutually exclusive)`,
          { stepId, workflowId, reason: 'ambiguous-target' },
        );
      }

      if (hasWorkflowId) {
        const reference = toValue(action.workflowId) as string;
        this.#chargeBudget(scope, invocation, stepId);
        const result = await this.#runReferencedWorkflow(
          reference,
          stepId,
          invocation,
          scope,
          'retry',
        );
        // the result's workflowId is the bare id the reference resolved to —
        // the key run state is recorded under, whichever document owns it.
        const refId = result.workflowId;
        state.setWorkflow(refId, {
          inputs: state.getWorkflow(refId)?.inputs ?? {},
          outputs: result.outputs,
        });
        retryReferences.push({
          kind: 'workflow',
          id: reference,
          successful: !this.#settledFailed(result),
          subWorkflow: result,
        });
        return;
      }

      const refStepId = toValue(action.stepId) as string;
      const refIndex = this.#interpreter.indexOfStep(steps, refStepId, workflowId, {
        reason: 'retry-target-not-found',
        label: 'retry reference',
      });
      const refStep = steps[refIndex];

      const refSubWorkflows: WorkflowExecutionResult[] = [];
      const outcome = await this.#chargedAttempt(
        this.#stepAttempt(refStep, refStepId, invocation, scope, refSubWorkflows),
        invocation,
        scope,
        refStepId,
      )();
      state.setStepOutputs(outcome.stepId, outcome.outputs);
      retryReferences.push({
        kind: 'step',
        id: refStepId,
        successful: outcome.successful,
        ...(refSubWorkflows.length > 0 ? { subWorkflow: refSubWorkflows[0] } : {}),
      });
    };
  }

  /**
   * Runs the workflows this workflow `dependsOn`, in declaration order, before
   * any of its own steps — the Arazzo "MUST be completed before this workflow can
   * be processed" precondition, satisfied on demand.
   *
   * Each dependency's outputs are recorded into the dependent's state so
   * `$workflows.{id}.outputs` resolves; they are not merged into the dependent's
   * own outputs. Runs stop at the first dependency that fails — the dependent
   * cannot be processed, so running the rest would be pointless work with live
   * side effects.
   *
   * Only workflows run *as prerequisites* are remembered as satisfying later
   * ones. A workflow that already ran in this tree as a sub-workflow **step**
   * target does not settle a later `dependsOn` on the same id, and runs again:
   * a step call is an explicit invocation carrying that step's parameters as
   * inputs, whereas a prerequisite runs with whatever the caller supplied in
   * `dependencyInputs`. Treating one as having discharged the other would
   * silently accept a run made with different inputs than the precondition asks
   * for.
   */
  async #runDependencies(
    workflow: WorkflowElement,
    invocation: WorkflowInvocation,
    scope: RunScope,
  ): Promise<WorkflowExecutionResult[]> {
    const { state, callStack, via } = invocation;
    // `runDependencies: false` is the caller vouching for the prerequisites of
    // the workflow they named. It stops there: a sub-workflow's own `dependsOn`
    // is an implementation detail the caller may not know exists, so skipping it
    // on their behalf would run that workflow against state nobody claimed to
    // have prepared — silently producing a wrong-but-`completed` result.
    if (via === 'root' && !scope.runDependencies) return [];
    if (!workflow.hasKey('dependsOn')) return [];

    // every entry is validated before the first one runs: an authoring error
    // found halfway down the list would otherwise be raised only after earlier
    // prerequisites had already fired live requests.
    const dependencyRefs = await this.#dependencyRefs(workflow, invocation);

    const results: WorkflowExecutionResult[] = [];
    for (const dependency of dependencyRefs) {
      const qualifiedId = this.#qualifiedId(dependency.locator);
      // a dependency already completed in this run is satisfied, not repeated: a
      // precondition holds once met, and a diamond (two dependents sharing one
      // dependency) must not duplicate its live side effects. Every dependent
      // still reports and reads that one run — including the inputs the run
      // was actually given, not whatever this dependent's own
      // `dependencyInputs` entry would have supplied had it run it.
      const memoized = scope.dependencyRuns.get(qualifiedId);
      const inputs = memoized?.inputs ?? scope.dependencyInputs[dependency.inputsKey] ?? {};
      const result =
        memoized?.result ??
        (await this.#run(dependency.locator, inputs, scope, callStack, 'dependsOn'));
      results.push(result);
      // recorded whether or not it completed: a failed prerequisite still
      // resolved (possibly partial) outputs, and the parent resolves its own
      // outputs against this state on its way out, so `$workflows.{id}` is
      // uniformly readable for every dependency that ran. `outputs` is the
      // dependency's own (`{}` when it transferred) — never the settled
      // workflow's, which would misattribute values to a declaration that
      // never ran. Keyed by the bare id even for a cross-document dependency:
      // `$workflows.{id}` is the only form an expression can read it back by.
      state.setWorkflow(dependency.locator.workflowId, { inputs, outputs: result.outputs });
      if (this.#settledFailed(result)) return results;

      // only a dependency whose chain settled non-`failed` is remembered as
      // satisfied — a failure, transferred or not, must never let a later
      // dependent skip running it.
      scope.dependencyRuns.set(qualifiedId, { result, inputs });
    }
    return results;
  }

  /**
   * The workflows a workflow declares in `dependsOn`, each resolved to its
   * locator, with every entry checked before any of them is run: the list
   * must be a list of strings, and each entry — a plain id or a
   * cross-document `$sourceDescriptions.{name}.{workflowId}` reference —
   * must name a workflow its document defines.
   *
   * Checking the whole list up front is the point. These are authoring errors,
   * and validating them one at a time as they are run would let a bad entry
   * halfway down the list throw only after the entries before it had already
   * made live requests.
   *
   * `inputsKey` is the entry as written, the key
   * {@link WorkflowExecuteOptions.dependencyInputs} addresses the dependency
   * by.
   */
  async #dependencyRefs(
    workflow: WorkflowElement,
    invocation: WorkflowInvocation,
  ): Promise<{ locator: ArazzoWorkflowLocator; inputsKey: string }[]> {
    const { workflowId, document } = invocation;
    const dependsOn = workflow.dependsOn;
    if (!isArrayElement(dependsOn)) {
      throw new ExecutionError(`workflow "${workflowId}" has a non-list "dependsOn"`, {
        workflowId,
        reason: 'malformed-dependsOn',
      });
    }

    const references = [...dependsOn].map((entry, index) => {
      if (!isStringElement(entry)) {
        throw new ExecutionError(
          `workflow "${workflowId}" has a non-string entry at dependsOn[${index}]`,
          { workflowId, reason: 'malformed-dependsOn' },
        );
      }
      return toValue(entry) as string;
    });

    const refs: { locator: ArazzoWorkflowLocator; inputsKey: string }[] = [];
    for (const reference of references) {
      const locator = await this.#workflowLocatorNormalizer.normalize(reference, document, {
        workflowId,
      });
      if (!locator.document.workflowIndex.has(locator.workflowId)) {
        throw new ExecutionError(
          `workflow "${workflowId}" depends on "${reference}", which the Arazzo document at "${locator.document.uri}" does not define`,
          { workflowId, reason: 'workflow-not-found' },
        );
      }
      refs.push({ locator, inputsKey: reference });
    }
    return refs;
  }

  /**
   * Builds the thunk that runs one attempt at a step, hiding which kind of step
   * it is from the retry loop.
   *
   * An operation step is delegated to {@link StepExecutor}. A step targeting a
   * `workflowId` is a sub-workflow call this executor runs itself — the case
   * StepExecutor refuses — mapping the step's `parameters` to the sub-workflow's
   * inputs, recording the sub-run under `$workflows`, then resolving the step's
   * own `outputs` and selecting its actions against that updated state. Because
   * both reduce to a {@link StepAttemptOutcome}, `retry` on a sub-workflow step
   * works as it does on an operation step: each attempt re-runs the sub-workflow
   * — its steps, that is — charged against the same budget. Prerequisites it
   * already completed stay satisfied and are not run again, since a completed
   * `dependsOn` workflow is memoized for the whole run; a retry re-runs the
   * work, not the preconditions.
   */
  #stepAttempt(
    step: StepElement,
    stepId: string,
    invocation: WorkflowInvocation,
    scope: RunScope,
    subWorkflows: WorkflowExecutionResult[],
  ): () => Promise<StepAttemptOutcome> {
    const { workflowId, document, state, callStack } = invocation;
    if (!isStringElement(step.workflowId)) {
      return () =>
        this.#stepExecutor.forDocument(document).execute(step, state, scope.executeOptions);
    }

    const reference = this.#subWorkflowReference(step, stepId, workflowId);
    const stepScope = { stepId };
    // the reference resolves to the same locator on every attempt, so it is
    // resolved once for the whole retry chain, on the first attempt; that
    // same first-attempt moment — before this call has written anything —
    // is when this call's own $workflows entry is pinned (typically absent,
    // but a legitimate value when an earlier, different step already called
    // the same workflowId), held fixed across every attempt below so a retry
    // never sees this call's *own* prior-attempt output. Everything else is
    // read live per attempt.
    let locator: ArazzoWorkflowLocator | undefined;
    let priorWorkflowEntry: Readonly<RuntimeExpressionWorkflowContext> | undefined;

    return async () => {
      if (locator === undefined) {
        locator = await this.#workflowLocatorNormalizer.normalize(reference, document, {
          workflowId,
          stepId,
        });
        priorWorkflowEntry = state.getWorkflow(locator.workflowId);
      }
      const subWorkflowId = locator.workflowId;

      // the sub-workflow's inputs come from the step's parameters, mapped by
      // bare name — per the specification, "all parameters map to workflow
      // inputs" for such a step. That includes an inherited parameter that
      // carries an `in` (the step's own carry none): it still arrives as an
      // input under its name, not under the '{in}.{name}' key an operation
      // step would deliver it by.
      //
      // Resolved fresh on every attempt, not once outside this thunk: a
      // `retry` action's reference can now mutate `$steps` / `$workflows`
      // between attempts (a repair a retried step's own parameters should
      // see), and freezing inputs once would hide that. The one thing that
      // must NOT drift attempt to attempt is this call's own target —
      // `#inputContext` pins `subWorkflowId`'s entry back to
      // `priorWorkflowEntry` so a parameter reading `$workflows.{subWorkflowId}`
      // sees the same (usually absent) value on every attempt, not the
      // previous attempt's own result.
      const preContext = this.#inputContext(state, subWorkflowId, priorWorkflowEntry);
      const inputs = this.#parameterResolver.resolve(
        step.parameters,
        (expression) => this.#evaluate(preContext, expression, document),
        stepScope,
      );

      const result = await this.#run(locator, inputs, scope, callStack, 'step');
      subWorkflows.push(result);
      state.setWorkflow(subWorkflowId, { inputs, outputs: result.outputs });

      // resolved after the sub-run is recorded, so the step's outputs can map
      // out of `$workflows.{subWorkflowId}.outputs`. There is no `$response` for
      // such a step — the context is purely the accumulated run state.
      const context = state.toContext();
      const outputs = this.#outputResolver.resolve(
        step.outputs,
        (expression) => this.#evaluate(context, expression, document),
        stepScope,
      );
      // an `end`ed sub-workflow returned to its caller with outputs, so it took
      // the success path like a completed one; only a chain settling `failed` is
      // a failure — a sub-workflow that transferred is judged by where its
      // chain settled, via `#settledFailed`, not by the intermediate
      // `'transferred'` status itself. The step's own `successCriteria` still
      // apply on top — they are the author's assertion about this step, and
      // dropping them because the step happens to target a workflow would
      // silently discard it. They see no `$response`, but do see the sub-run's
      // own outputs (`{}` when it transferred) through `$workflows`.
      // the criteria and actions are the *calling* step's, so they are
      // evaluated by the parent document's step executor — only the sub-run
      // itself switched documents.
      const stepExecutor = this.#stepExecutor.forDocument(document);
      const successful =
        !this.#settledFailed(result) && stepExecutor.evaluateCriteria(step, context);
      const matchedActions = stepExecutor.selectActions(step, successful, context);

      return { stepId, successful, outputs, action: matchedActions[0], matchedActions };
    };
  }

  /**
   * The live run context, with `workflowId`'s own `$workflows` entry pinned to
   * `entry` rather than whatever `state` holds right now.
   *
   * Used to resolve a sub-workflow step's inputs on a retry: every other path
   * (`$steps`, every *other* `$workflows` entry, `$inputs`) must be read live,
   * so a `retry` reference's repair between attempts is visible — but this
   * call's own target must not, or a retried attempt would read its own
   * previous attempt's output instead of the value it had before this step's
   * retry chain began. `toContext` builds a fresh plain object per call, so
   * overriding one key here never touches `state` itself.
   */
  #inputContext(
    state: WorkflowExecutionState,
    workflowId: string,
    entry: Readonly<RuntimeExpressionWorkflowContext> | undefined,
  ): RuntimeExpressionContext {
    const context = state.toContext();
    const { [workflowId]: _current, ...workflows } = context.workflows ?? {};
    return {
      ...context,
      workflows: entry === undefined ? workflows : { ...workflows, [workflowId]: entry },
    };
  }

  /**
   * The reference a sub-workflow step targets, as written — a plain
   * workflowId of the current document, or a cross-document
   * `$sourceDescriptions.{name}.{workflowId}` runtime expression.
   */
  #subWorkflowReference(step: StepElement, stepId: string, workflowId: string): string {
    // a step names its target once: declaring any other target alongside a
    // workflow is malformed and has no defined resolution. StepExecutor makes
    // the same check, but a sub-workflow step never reaches it — so both read
    // the one list of target fields, and a target added to the specification
    // cannot be rejected by one and silently accepted by the other.
    const conflicting = STEP_TARGET_FIELDS.filter(
      (field) => field !== 'workflowId' && isStringElement(step[field]),
    );
    if (conflicting.length > 0) {
      throw new ExecutionError(
        `step "${stepId}" in workflow "${workflowId}" declares a workflowId alongside ${conflicting.join(', ')} (mutually exclusive)`,
        { stepId, workflowId, reason: 'ambiguous-target' },
      );
    }

    return toValue(step.workflowId) as string;
  }

  /**
   * Runs a workflow an action references directly — a retry's `workflowId`
   * reference or a goto's transfer, plain id or cross-document expression —
   * with `{}` inputs, since neither has an input-mapping mechanism of its own
   * (issue `#62`).
   *
   * Shared rather than duplicated by its two callers, which otherwise repeat
   * the identical "resolve the reference, then run with no inputs" sequence.
   * Rejects a target its document does not define with the calling `stepId`
   * attached, unlike {@link WorkflowExecutor.#resolveWorkflow}'s own
   * `workflow-not-found` (reached only once `#run` itself resolves the
   * target) — which carries no caller context at all, since it is reached
   * generically from every kind of nested call.
   */
  async #runReferencedWorkflow(
    reference: string,
    stepId: string,
    invocation: WorkflowInvocation,
    scope: RunScope,
    via: WorkflowCallVia,
  ): Promise<WorkflowExecutionResult> {
    const locator = await this.#workflowLocatorNormalizer.normalize(
      reference,
      invocation.document,
      { workflowId: invocation.workflowId, stepId },
    );
    if (!locator.document.workflowIndex.has(locator.workflowId)) {
      throw new ExecutionError(
        `workflow "${locator.workflowId}" not found in Arazzo document at "${locator.document.uri}"`,
        { workflowId: locator.workflowId, stepId, reason: 'workflow-not-found' },
      );
    }
    return this.#run(locator, {}, scope, invocation.callStack, via);
  }

  /**
   * Extracts and normalizes the workflow a locator names. A workflow its
   * document does not define is the executor-level `workflow-not-found`
   * authoring error, raised here rather than leaking the extractor's
   * `ExtractionError`.
   */
  async #resolveWorkflow(
    locator: ArazzoWorkflowLocator,
    scope: RunScope,
  ): Promise<WorkflowElement> {
    const { document, workflowId } = locator;
    const qualifiedId = this.#qualifiedId(locator);
    const cached = scope.workflows.get(qualifiedId);
    if (cached !== undefined) return cached;

    if (!document.workflowIndex.has(workflowId)) {
      throw new ExecutionError(
        `workflow "${workflowId}" not found in Arazzo document at "${document.uri}"`,
        { workflowId, reason: 'workflow-not-found' },
      );
    }
    const workflow = await this.#normalizer.normalize(
      this.#extractor.extract(document, workflowId),
      document,
    );
    scope.workflows.set(qualifiedId, workflow);
    return workflow;
  }

  /**
   * The run-wide identity of the workflow a locator names —
   * `{documentURI}#{workflowId}`, the key the normalized-workflow cache and
   * the dependency ledger share (the call stack compares the same pair,
   * unformatted). Qualified because a bare workflowId is only unique within
   * its own document.
   */
  #qualifiedId(locator: ArazzoWorkflowLocator): string {
    return `${locator.document.uri}#${locator.workflowId}`;
  }

  /**
   * The workflow's steps as an array in list order. An absent `steps` is a
   * workflow with no steps — an empty list, a completed no-op run. A present but
   * malformed `steps` (not a list, or holding a non-step entry) is an authoring
   * error and throws rather than being silently treated as empty or partial.
   */
  #orderedSteps(workflow: WorkflowElement, workflowId: string): StepElement[] {
    if (!workflow.hasKey('steps')) return [];

    const steps = workflow.steps;
    if (!isArrayElement(steps)) {
      throw new ExecutionError(`workflow "${workflowId}" has a non-list "steps"`, {
        workflowId,
        reason: 'malformed-steps',
      });
    }

    return [...steps].map((step, index) => {
      if (!isStepElement(step)) {
        throw new ExecutionError(
          `workflow "${workflowId}" has a non-step entry at steps[${index}]`,
          { workflowId, reason: 'malformed-steps' },
        );
      }
      return step;
    });
  }

  /**
   * Checks that the workflow's `outputs`, if present, is a map — without
   * resolving any of its values. The same check {@link OutputResolver.resolve}
   * makes on its way to actually resolving them, run here early instead: the
   * shape needs no run state, so this can — and, to keep a malformed `outputs`
   * from costing the run its live side effects, must — happen alongside
   * {@link WorkflowExecutor.#orderedSteps}, before any prerequisite or step of
   * the workflow runs.
   */
  #validateWorkflowOutputsShape(workflow: WorkflowElement, workflowId: string): void {
    if (!workflow.hasKey('outputs')) return;

    const outputs = workflow.outputs;
    if (isObjectElement(outputs)) return;

    throw new ResolverError('`outputs` is present but is not a map', {
      workflowId,
      target: 'outputs',
      reason: 'malformed-outputs',
    });
  }

  /**
   * Resolves the workflow's `outputs` declaration against the final run state,
   * mirroring how {@link StepExecutor} resolves a step's outputs.
   */
  #resolveWorkflowOutputs(
    workflow: WorkflowElement,
    invocation: WorkflowInvocation,
  ): Record<string, unknown> {
    const context = invocation.state.toContext();
    return this.#outputResolver.resolve(
      workflow.outputs,
      (expression) => this.#evaluate(context, expression, invocation.document),
      { workflowId: toValue(workflow.workflowId) as string },
    );
  }

  /**
   * Resolves a runtime expression leniently against a context, forwarding
   * `$components` / `$sourceDescriptions` resolution to the given document —
   * the invocation's, so a foreign workflow's expressions resolve against
   * the document that owns it — and the registry; the workflow-scoped
   * counterpart of {@link StepExecutor}'s bridge.
   */
  #evaluate(
    context: RuntimeExpressionContext,
    expression: string,
    document: ArazzoDocument,
  ): unknown {
    return new RuntimeExpressionEvaluator(context, {
      strict: false,
      document,
      registry: this.#registry,
    }).evaluate(expression);
  }
}

export default WorkflowExecutor;

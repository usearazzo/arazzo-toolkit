import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isNumberElement, isStringElement } from '@speclynx/apidom-datamodel';
import {
  isStepElement,
  isFailureActionElement,
  type WorkflowElement,
  type StepElement,
  type FailureActionElement,
} from '@speclynx/apidom-ns-arazzo-1';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import type DocumentRegistry from '../registry/DocumentRegistry.ts';
import type { WorkflowId } from '../document/ArazzoWorkflowIndex.ts';
import type { RuntimeExpressionContext } from '../expression/RuntimeExpressionContext.ts';
import RuntimeExpressionEvaluator from '../expression/RuntimeExpressionEvaluator.ts';
import ArazzoWorkflowExtractor from '../extractor/ArazzoWorkflowExtractor.ts';
import ArazzoWorkflowNormalizer from '../normalizer/ArazzoWorkflowNormalizer.ts';
import OutputResolver from '../resolver/OutputResolver.ts';
import ParameterResolver from '../resolver/ParameterResolver.ts';
import WorkflowExecutionState from '../state/WorkflowExecutionState.ts';
import StepExecutor, { STEP_TARGET_FIELDS, type StepDefaultActions } from './StepExecutor.ts';
import type { SelectedAction } from '../action/ActionResolver.ts';
import ExecutionError from '../errors/ExecutionError.ts';

/**
 * Options for the WorkflowExecutor.
 * @public
 */
export interface WorkflowExecutorOptions {
  /**
   * The entry Arazzo document holding the workflows to run; also the source of
   * `$components` / `$sourceDescriptions` the executor resolves workflow
   * `outputs` against.
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
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Reads the current wall-clock time in milliseconds, used for the `durationMs`
   * of each run and step. Injected so tests assert exact durations; defaults to
   * `Date.now`.
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
   * workflowId; consulted for transitive dependencies too. A dependency with no
   * entry runs with no inputs.
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
   */
  readonly runDependencies?: boolean;
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
   * Wall-clock time the step took, covering every attempt and the `retryAfter`
   * waits between them.
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
}

/**
 * The outcome of executing a workflow.
 *
 * `status` is `completed` when the steps ran to the end of the list, `ended`
 * when an `end` action stopped the run early, and `failed` when a step failed
 * and no matching `onFailure` action redirected it (the break-and-return
 * default) — or when a `dependsOn` workflow did not complete.
 * @public
 */
export interface WorkflowExecutionResult {
  readonly workflowId: string;
  readonly outputs: Record<string, unknown>;
  readonly steps: readonly StepRunRecord[];
  readonly status: 'completed' | 'ended' | 'failed';
  /**
   * Wall-clock time the run took, including its dependencies, sub-workflows, and
   * retry waits.
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
}

/**
 * The control-flow transition selected for a step outcome — how the loop
 * advances after interpreting the step's {@link SelectedAction}.
 *
 * `next` runs the following step (the success default, or a matched `goto` that
 * targets the next step); `goto` jumps to a step by id within the current
 * workflow; `end` stops the run with `status: ended`; `break` stops with
 * `status: failed` (the failure default).
 */
type Transition =
  | { readonly kind: 'next' }
  | { readonly kind: 'goto'; readonly stepId: string }
  | { readonly kind: 'end' }
  | { readonly kind: 'break' };

/**
 * How a workflow invocation was entered. Recorded per call-stack frame so a
 * detected loop can be named for the mechanism that formed it: a repeat reached
 * purely through `dependsOn` edges is a `dependsOn-cycle`, one involving a
 * sub-workflow step call is a `workflow-cycle`.
 */
type CallVia = 'root' | 'step' | 'dependsOn';

/**
 * One workflow invocation in progress, as recorded on the call stack.
 */
interface CallFrame {
  readonly workflowId: string;
  readonly via: CallVia;
}

/**
 * The position of a workflow invocation within the call tree: which workflows
 * are in progress above it, and how deep it sits. Rebuilt (never mutated) for
 * each nested call, so unwinding is implicit and reentrancy-safe.
 */
interface RunFrame {
  readonly callStack: readonly CallFrame[];
  readonly depth: number;
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
   * Step attempts spent so far, across every workflow in the tree.
   */
  readonly budget: { spent: number };
  /**
   * Results of the `dependsOn` workflows already completed in this run, keyed by
   * workflowId — a dependency reached again (a diamond) is satisfied from here
   * rather than run twice.
   */
  readonly dependencyRuns: Map<string, WorkflowExecutionResult>;
}

/**
 * What one attempt at a step produced. Both kinds of step reduce to this: an
 * operation step (delegated to {@link StepExecutor}, whose richer result
 * satisfies this shape) and a sub-workflow step (synthesized from the sub-run's
 * outcome), so the retry loop drives them identically.
 */
interface StepAttemptOutcome {
  readonly stepId: string;
  readonly successful: boolean;
  readonly outputs: Record<string, unknown>;
  readonly action: SelectedAction | undefined;
  readonly matchedActions: readonly SelectedAction[];
}

/**
 * Executes an Arazzo workflow: the stateful loop that turns "run one step" into
 * "run a workflow".
 *
 * It iterates a workflow's steps in list order, delegating each to
 * {@link StepExecutor}, records the resolved step outputs into a
 * {@link WorkflowExecutionState} so later steps read `$steps.{id}.outputs.{name}`,
 * and interprets the {@link SelectedAction} the step executor selects but does
 * not act on — advancing to the next step, jumping via `goto`, or stopping on
 * `end` / the failure break-default. After the loop it resolves the workflow's
 * `outputs` against the final state.
 *
 * A step targeting a `workflowId` is a sub-workflow call the executor runs
 * itself, recursively; the workflows named by `dependsOn` are run to completion
 * before the workflow's own steps. Both recurse through one call tree, guarded
 * by a shared step budget, a nesting-depth ceiling, and cycle detection.
 *
 * State is created fresh per {@link WorkflowExecutor.execute} call — and per
 * workflow invocation within it — and owned here; the returned result is
 * read-only. Authoring errors (missing workflow, unknown `goto` target, a cycle,
 * budget overflow) throw {@link ExecutionError}; a step that legitimately fails
 * and breaks, or a dependency that fails, is a normal `status: 'failed'` result,
 * not a throw — the same split {@link StepExecutor} draws.
 *
 * Not yet supported, throwing rather than behaving incorrectly: a step-level
 * `goto` to a workflow, a `retry` carrying a `stepId` / `workflowId` reference,
 * and cross-document workflow references.
 * @public
 */
class WorkflowExecutor {
  static readonly #DEFAULT_MAX_STEPS = 1000;
  static readonly #DEFAULT_MAX_WORKFLOW_DEPTH = 32;
  static readonly #DEFAULT_RETRY_LIMIT = 1;
  static readonly #DEFAULT_SLEEP = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  static readonly #DEFAULT_NOW = (): number => Date.now();

  readonly #document: ArazzoDocument;
  readonly #registry: DocumentRegistry;
  readonly #maxSteps: number;
  readonly #maxWorkflowDepth: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #extractor = new ArazzoWorkflowExtractor();
  readonly #normalizer = new ArazzoWorkflowNormalizer();
  readonly #outputResolver = new OutputResolver();
  readonly #parameterResolver = new ParameterResolver();
  readonly #stepExecutor: StepExecutor;

  constructor(options: WorkflowExecutorOptions) {
    this.#document = options.document;
    this.#registry = options.registry;
    this.#maxSteps = options.maxSteps ?? WorkflowExecutor.#DEFAULT_MAX_STEPS;
    this.#maxWorkflowDepth =
      options.maxWorkflowDepth ?? WorkflowExecutor.#DEFAULT_MAX_WORKFLOW_DEPTH;
    this.#sleep = options.sleep ?? WorkflowExecutor.#DEFAULT_SLEEP;
    this.#now = options.now ?? WorkflowExecutor.#DEFAULT_NOW;
    this.#stepExecutor = options.stepExecutor;
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
    const scope: RunScope = {
      executeOptions: options.executeOptions ?? {},
      dependencyInputs: options.dependencyInputs ?? {},
      runDependencies: options.runDependencies ?? true,
      budget: { spent: 0 },
      dependencyRuns: new Map(),
    };
    return this.#run(workflowId, options.inputs ?? {}, scope, { callStack: [], depth: 0 }, 'root');
  }

  /**
   * Runs one workflow invocation — the recursive worker every entry point funnels
   * through: the public {@link WorkflowExecutor.execute}, a sub-workflow step,
   * and a `dependsOn` prerequisite alike, each passing the frame extended with
   * its own call.
   */
  async #run(
    workflowId: WorkflowId,
    inputs: Record<string, unknown>,
    scope: RunScope,
    frame: RunFrame,
    via: CallVia,
  ): Promise<WorkflowExecutionResult> {
    const startedAt = this.#now();
    this.#guardCall(workflowId, via, frame);
    // the frame is rebuilt rather than mutated, so this call's entry unwinds
    // implicitly on return: a throw cannot leave a stale entry behind, and
    // sibling calls (a diamond — A calling B and C, both calling D) each see
    // only their own chain, so a completed-and-unwound revisit is never a cycle.
    const nested: RunFrame = {
      callStack: [...frame.callStack, { workflowId, via }],
      depth: frame.depth + 1,
    };

    const workflow = await this.#resolveWorkflow(workflowId);
    const state = new WorkflowExecutionState({ inputs });
    // the workflow-level default actions every step falls back to when it
    // declares no onSuccess / onFailure of its own (resolved once per run).
    const defaultActions: StepDefaultActions = {
      onSuccess: workflow.successActions,
      onFailure: workflow.failureActions,
    };

    // validated before any prerequisite runs: a malformed `steps` is an
    // authoring error, and discovering it only after the dependencies have
    // fired would mean live side effects on the way to a throw.
    const steps = this.#orderedSteps(workflow, workflowId);

    const dependencies = await this.#runDependencies(workflow, workflowId, state, scope, nested);
    if (dependencies.some((dependency) => dependency.status === 'failed')) {
      // a declared prerequisite did not complete, so this workflow cannot be
      // processed. That is a runtime failure like any failing step — a `failed`
      // result carrying the dependency trace, not a throw — and none of its own
      // steps run.
      return this.#result(workflowId, workflow, state, [], 'failed', dependencies, startedAt);
    }

    const trace: StepRunRecord[] = [];
    let index = 0;
    let status: WorkflowExecutionResult['status'] = 'completed';

    while (index < steps.length) {
      const step = steps[index];
      const stepId = toValue(step.stepId) as string;
      const stepStartedAt = this.#now();
      // the sub-workflow runs this step produces — one per attempt, so a retried
      // sub-workflow step keeps every attempt's trace rather than only the last.
      const subWorkflows: WorkflowExecutionResult[] = [];
      const attempt = this.#stepAttempt(
        step,
        stepId,
        workflowId,
        state,
        defaultActions,
        scope,
        nested,
        subWorkflows,
      );

      // run the step, honoring any retry actions internally; `action` is the
      // terminal action after retries are exhausted (retry itself never leaves
      // this call), and `attempts` is how many times the step ran.
      const { outcome, action, attempts } = await this.#runStepWithRetry(
        attempt,
        workflowId,
        stepId,
        scope,
        nested,
      );
      state.setStepOutputs(outcome.stepId, outcome.outputs);
      trace.push({
        stepId: outcome.stepId,
        successful: outcome.successful,
        action,
        attempts,
        durationMs: this.#now() - stepStartedAt,
        ...(subWorkflows.length > 0 ? { subWorkflows } : {}),
      });

      const transition = this.#interpret(action, outcome.successful, workflowId, stepId);
      if (transition.kind === 'next') {
        index += 1;
      } else if (transition.kind === 'goto') {
        index = this.#indexOfStep(steps, transition.stepId, workflowId);
      } else if (transition.kind === 'end') {
        status = 'ended';
        break;
      } else {
        status = 'failed';
        break;
      }
    }

    return this.#result(workflowId, workflow, state, trace, status, dependencies, startedAt);
  }

  /**
   * Assembles the run's result, resolving the workflow's `outputs` against the
   * final state and stamping the elapsed time. `dependencies` is reported only
   * when the workflow actually had some.
   */
  #result(
    workflowId: string,
    workflow: WorkflowElement,
    state: WorkflowExecutionState,
    steps: readonly StepRunRecord[],
    status: WorkflowExecutionResult['status'],
    dependencies: readonly WorkflowExecutionResult[],
    startedAt: number,
  ): WorkflowExecutionResult {
    return {
      workflowId,
      outputs: this.#resolveWorkflowOutputs(workflow, state),
      steps,
      status,
      durationMs: this.#now() - startedAt,
      ...(dependencies.length > 0 ? { dependencies } : {}),
    };
  }

  /**
   * Rejects a workflow invocation that cannot legitimately proceed: one already
   * in progress on the current call chain (a cycle), or one nested past the depth
   * ceiling.
   *
   * The cycle check comes first deliberately. A self-referential chain would
   * eventually trip the depth guard too, but only after exhausting the whole
   * budget of frames and then reporting the wrong cause — a cycle is reported as
   * a cycle, at the moment the workflow is re-entered, carrying the offending
   * chain as `path`.
   */
  #guardCall(workflowId: WorkflowId, via: CallVia, frame: RunFrame): void {
    const repeated = frame.callStack.findIndex((call) => call.workflowId === workflowId);
    if (repeated !== -1) {
      const path = [...frame.callStack.map((call) => call.workflowId), workflowId];
      // name the loop for the mechanism that formed it: every edge closing the
      // cycle being a `dependsOn` edge makes it a dependency cycle, while any
      // sub-workflow step call in the loop makes it a call cycle. One shared
      // stack detects both, so a loop crossing the two mechanisms cannot slip
      // between them.
      const closingEdges = [...frame.callStack.slice(repeated + 1).map((call) => call.via), via];
      const reason = closingEdges.every((edge) => edge === 'dependsOn')
        ? 'dependsOn-cycle'
        : 'workflow-cycle';
      throw new ExecutionError(
        `workflow "${workflowId}" is already in progress; its call chain forms a cycle (${path.join(' -> ')})`,
        { workflowId, reason, path },
      );
    }

    if (frame.depth >= this.#maxWorkflowDepth) {
      throw new ExecutionError(
        `workflow "${workflowId}" nests deeper than the limit of ${this.#maxWorkflowDepth} workflows`,
        {
          workflowId,
          reason: 'workflow-depth',
          // the chain that got here, for the same reason the cycle and budget
          // errors carry one: the leaf that happened to exceed the ceiling is
          // rarely the workflow whose nesting the author needs to look at.
          path: [...frame.callStack.map((call) => call.workflowId), workflowId],
        },
      );
    }
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
   */
  async #runDependencies(
    workflow: WorkflowElement,
    workflowId: string,
    state: WorkflowExecutionState,
    scope: RunScope,
    frame: RunFrame,
  ): Promise<WorkflowExecutionResult[]> {
    if (!scope.runDependencies || !workflow.hasKey('dependsOn')) return [];

    const dependsOn = workflow.dependsOn;
    if (!isArrayElement(dependsOn)) {
      throw new ExecutionError(`workflow "${workflowId}" has a non-list "dependsOn"`, {
        workflowId,
        reason: 'malformed-dependsOn',
      });
    }

    const results: WorkflowExecutionResult[] = [];
    for (const [index, entry] of [...dependsOn].entries()) {
      if (!isStringElement(entry)) {
        throw new ExecutionError(
          `workflow "${workflowId}" has a non-string entry at dependsOn[${index}]`,
          { workflowId, reason: 'malformed-dependsOn' },
        );
      }
      const dependencyId = toValue(entry) as string;
      this.#rejectCrossDocumentWorkflow(dependencyId, workflowId);

      const inputs = scope.dependencyInputs[dependencyId] ?? {};
      // a dependency already completed in this run is satisfied, not repeated: a
      // precondition holds once met, and a diamond (two dependents sharing one
      // dependency) must not duplicate its live side effects. Every dependent
      // still reports and reads that one run.
      const memoized = scope.dependencyRuns.get(dependencyId);
      const result = memoized ?? (await this.#run(dependencyId, inputs, scope, frame, 'dependsOn'));
      results.push(result);
      // recorded whether or not it completed: a failed prerequisite still
      // resolved (possibly partial) outputs, and the parent resolves its own
      // outputs against this state on its way out, so `$workflows.{id}` is
      // uniformly readable for every dependency that ran.
      state.setWorkflow(dependencyId, { inputs, outputs: result.outputs });
      if (result.status === 'failed') return results;

      // only a *completed* dependency is remembered as satisfied — a failure must
      // never let a later dependent skip running it.
      scope.dependencyRuns.set(dependencyId, result);
    }
    return results;
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
    workflowId: string,
    state: WorkflowExecutionState,
    defaultActions: StepDefaultActions,
    scope: RunScope,
    frame: RunFrame,
    subWorkflows: WorkflowExecutionResult[],
  ): () => Promise<StepAttemptOutcome> {
    if (!isStringElement(step.workflowId)) {
      return () => this.#stepExecutor.execute(step, state, scope.executeOptions, defaultActions);
    }

    const subWorkflowId = this.#subWorkflowId(step, stepId, workflowId);
    // the sub-workflow's inputs come from the step's parameters, mapped by name —
    // a workflowId step's parameters carry no `in`, being inputs to a workflow
    // rather than parts of a request.
    //
    // Resolved once here, against the state as the step is entered, rather than
    // per attempt: a retry re-runs *this* invocation of the step, so it must
    // re-run it with the inputs it was invoked with. Resolving inside the attempt
    // would read a state that each attempt has already written its own
    // `$workflows.{subWorkflowId}` into, so a parameter reading that entry would
    // drift from one attempt to the next. An operation step's parameters are
    // likewise identical across attempts — there, because nothing mutates the
    // state mid-retry.
    const preContext = state.toContext();
    const inputs = this.#parameterResolver.resolve(step.parameters, (expression) =>
      this.#evaluate(preContext, expression),
    );

    return async () => {
      const result = await this.#run(subWorkflowId, inputs, scope, frame, 'step');
      subWorkflows.push(result);
      state.setWorkflow(subWorkflowId, { inputs, outputs: result.outputs });

      // resolved after the sub-run is recorded, so the step's outputs can map
      // out of `$workflows.{subWorkflowId}.outputs`. There is no `$response` for
      // such a step — the context is purely the accumulated run state.
      const context = state.toContext();
      const outputs = this.#outputResolver.resolve(step.outputs, (expression) =>
        this.#evaluate(context, expression),
      );
      // an `end`ed sub-workflow returned to its caller with outputs, so it took
      // the success path like a completed one; only `failed` is a failure. The
      // step's own `successCriteria` still apply on top — they are the author's
      // assertion about this step, and dropping them because the step happens to
      // target a workflow would silently discard it. They see no `$response`,
      // but do see the sub-run's outputs through `$workflows`.
      const successful =
        result.status !== 'failed' && this.#stepExecutor.evaluateCriteria(step, context);
      const matchedActions = this.#stepExecutor.selectActions(
        step,
        successful,
        context,
        defaultActions,
      );

      return { stepId, successful, outputs, action: matchedActions[0], matchedActions };
    };
  }

  /**
   * The id of the workflow a sub-workflow step targets.
   *
   * A `workflowId` naming a workflow in another document is written as a runtime
   * expression (`$sourceDescriptions.{name}.{workflowId}`); resolving those is
   * not supported yet, so it is rejected rather than looked up as a literal id
   * that cannot exist.
   */
  #subWorkflowId(step: StepElement, stepId: string, workflowId: string): string {
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

    const subWorkflowId = toValue(step.workflowId) as string;
    this.#rejectCrossDocumentWorkflow(subWorkflowId, workflowId, stepId);
    return subWorkflowId;
  }

  /**
   * Rejects a workflow reference into another document — written as a
   * `$sourceDescriptions.{name}.{workflowId}` runtime expression — which is not
   * resolvable yet. Same-document ids only.
   */
  #rejectCrossDocumentWorkflow(reference: string, workflowId: string, stepId?: string): void {
    if (!reference.startsWith('$')) return;

    throw new ExecutionError(
      `workflow reference "${reference}" in workflow "${workflowId}" points to another document; not supported yet`,
      { workflowId, stepId, reason: 'cross-document-workflow-unsupported' },
    );
  }

  /**
   * Extracts and normalizes the workflow by id. A workflow the entry document
   * does not define is the executor-level `workflow-not-found` authoring error,
   * raised here rather than leaking the extractor's `ExtractionError`.
   */
  async #resolveWorkflow(workflowId: WorkflowId): Promise<WorkflowElement> {
    if (!this.#document.workflowIndex.has(workflowId)) {
      throw new ExecutionError(
        `workflow "${workflowId}" not found in Arazzo document at "${this.#document.uri}"`,
        { workflowId, reason: 'workflow-not-found' },
      );
    }
    const workflow = this.#extractor.extract(this.#document, workflowId);
    return this.#normalizer.normalize(workflow, this.#document);
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
   * Interprets the terminal action a step resolved to into the loop's next
   * transition.
   *
   * With no matching action, applies the path default: the next sequential step
   * on success, break-and-return on failure. A `goto` targeting a `stepId` jumps
   * within the current workflow. `retry` never reaches here — it is consumed by
   * {@link WorkflowExecutor.#runStepWithRetry}, which returns only the terminal
   * action a retry chain resolves to. `goto` targeting a `workflowId` is not yet
   * supported and throws.
   */
  #interpret(
    action: SelectedAction | undefined,
    successful: boolean,
    workflowId: string,
    stepId: string,
  ): Transition {
    if (action === undefined) {
      // path default: next step on success, break-and-return on failure.
      return successful ? { kind: 'next' } : { kind: 'break' };
    }

    const type = toValue(action.type) as string;
    if (type === 'end') {
      return { kind: 'end' };
    }
    if (type === 'goto') {
      if (isStringElement(action.workflowId)) {
        throw new ExecutionError(
          `action on step "${stepId}" in workflow "${workflowId}" gotos a workflowId; not supported yet`,
          { stepId, workflowId, reason: 'goto-workflow-unsupported' },
        );
      }
      if (isStringElement(action.stepId)) {
        return { kind: 'goto', stepId: toValue(action.stepId) as string };
      }
      throw new ExecutionError(
        `goto action on step "${stepId}" in workflow "${workflowId}" has neither stepId nor workflowId`,
        { stepId, workflowId, reason: 'goto-target-missing' },
      );
    }

    // an unknown action type is malformed input, not a defined control flow.
    // (`retry` is resolved away in #runStepWithRetry and never arrives here.)
    throw new ExecutionError(
      `action on step "${stepId}" in workflow "${workflowId}" has unsupported type "${type}"`,
      { stepId, workflowId, reason: 'unknown-action-type' },
    );
  }

  /**
   * Runs a step, applying its `retry` failure actions before returning a
   * terminal outcome.
   *
   * On success (or an immediate non-retry failure) the step runs once. On a
   * failure whose first matching action is a `retry`, the step is re-run up to
   * that action's `retryLimit` (default 1) with a `retryAfter`-second delay
   * between attempts. Per spec — "retryLimit MUST be exhausted prior to executing
   * subsequent failure actions" — an exhausted retry falls through to the *next*
   * matching failure action of the latest attempt, which may itself be another
   * `retry` with its own independent budget, or a terminal `end` / `goto`. Each
   * attempt re-runs the step and re-selects against the fresh outcome.
   *
   * Returns the last attempt's `outcome`, the resolved terminal `action` (never a
   * `retry`; `undefined` when nothing terminal matched, so the loop applies the
   * path default), and the number of `attempts` made.
   */
  async #runStepWithRetry(
    attempt: () => Promise<StepAttemptOutcome>,
    workflowId: string,
    stepId: string,
    scope: RunScope,
    frame: RunFrame,
  ): Promise<{
    outcome: StepAttemptOutcome;
    action: SelectedAction | undefined;
    attempts: number;
  }> {
    // attempts already spent on each retry action, keyed by the action element.
    // The element is the correct identity here: re-running the step returns the
    // same element instances (the workflow is normalized once and `onFailure`'s
    // getter returns its stored children — nothing re-refracts per call), and
    // keying by the element survives the criteria re-filtering that varies
    // `matchedActions` between attempts (position within that filtered list is
    // NOT stable when a response change drops an earlier action). So each retry
    // in a chain keeps its own independent budget across re-runs.
    const retriesSpent = new Map<SelectedAction, number>();
    let attempts = 0;

    for (;;) {
      // charge the run-wide budget per attempt — this is what bounds a runaway
      // retry, a runaway goto loop, and a runaway tree of sub-workflow calls
      // alike, rather than an unbounded spin. The budget spans the whole call
      // tree, so a sub-workflow cannot start afresh.
      if (++scope.budget.spent > this.#maxSteps) {
        throw new ExecutionError(
          `workflow "${workflowId}" exceeded its budget of ${this.#maxSteps} step attempts (a goto loop, excessive retries, or runaway sub-workflow calls)`,
          {
            workflowId,
            stepId,
            reason: 'step-budget',
            path: [...frame.callStack.map((call) => call.workflowId)],
          },
        );
      }

      const outcome = await attempt();
      attempts += 1;

      if (outcome.successful) {
        return { outcome, action: outcome.action, attempts };
      }

      // walk the matching failure actions: fire the first retry that still has
      // budget, else fall through to the first terminal (non-retry) action.
      let fired = false;
      let terminal: SelectedAction | undefined;
      for (const action of outcome.matchedActions) {
        if (!this.#isRetry(action)) {
          terminal = action;
          break;
        }
        const spent = retriesSpent.get(action) ?? 0;
        if (spent >= this.#retryLimit(action)) continue; // exhausted — try the next action

        this.#rejectRetryReference(action, stepId, workflowId);
        retriesSpent.set(action, spent + 1);
        // only sleep for a real, positive delay — skip the event-loop yield of
        // sleep(0) for immediate retries, and never hand a custom sleep a
        // zero/negative/NaN value.
        const delayMs = this.#retryAfterMs(action);
        if (delayMs > 0) await this.#sleep(delayMs);
        fired = true;
        break;
      }

      if (fired) continue; // re-run the step
      return { outcome, action: terminal, attempts };
    }
  }

  /**
   * Whether a matched action is a `retry` failure action (narrowing it to
   * {@link FailureActionElement} so `retryLimit` / `retryAfter` are accessible).
   */
  #isRetry(action: SelectedAction): action is FailureActionElement {
    return isFailureActionElement(action) && (toValue(action.type) as string) === 'retry';
  }

  /**
   * A `retry` action's attempt budget — its `retryLimit`, or the default of 1
   * when unset or non-numeric.
   */
  #retryLimit(action: FailureActionElement): number {
    return isNumberElement(action.retryLimit)
      ? (toValue(action.retryLimit) as number)
      : WorkflowExecutor.#DEFAULT_RETRY_LIMIT;
  }

  /**
   * The delay before a retry, in milliseconds — the action's `retryAfter`
   * (seconds) converted. `0` when unset, non-numeric, or not a finite positive
   * value (a negative or `NaN` `retryAfter` means "no wait", never a bad value
   * handed to `sleep`).
   */
  #retryAfterMs(action: FailureActionElement): number {
    if (!isNumberElement(action.retryAfter)) return 0;
    const ms = (toValue(action.retryAfter) as number) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  /**
   * Rejects a `retry` action that carries a `stepId` / `workflowId` reference to
   * execute before retrying — a defined feature ("the reference is executed and
   * the context is returned, after which the current step is retried") that is
   * not yet supported, so it throws rather than silently ignoring the reference.
   */
  #rejectRetryReference(action: FailureActionElement, stepId: string, workflowId: string): void {
    if (isStringElement(action.stepId) || isStringElement(action.workflowId)) {
      throw new ExecutionError(
        `retry action on step "${stepId}" in workflow "${workflowId}" carries a stepId/workflowId reference; not supported yet`,
        { stepId, workflowId, reason: 'retry-reference-unsupported' },
      );
    }
  }

  /**
   * The index of the `goto` target step within the current workflow; a target
   * that names no step in this workflow is an authoring error.
   */
  #indexOfStep(steps: readonly StepElement[], stepId: string, workflowId: string): number {
    const index = steps.findIndex((step) => (toValue(step.stepId) as string) === stepId);
    if (index === -1) {
      throw new ExecutionError(
        `goto target step "${stepId}" not found in workflow "${workflowId}"`,
        { stepId, workflowId, reason: 'goto-target-not-found' },
      );
    }
    return index;
  }

  /**
   * Resolves the workflow's `outputs` declaration against the final run state,
   * mirroring how {@link StepExecutor} resolves a step's outputs.
   */
  #resolveWorkflowOutputs(
    workflow: WorkflowElement,
    state: WorkflowExecutionState,
  ): Record<string, unknown> {
    const context = state.toContext();
    return this.#outputResolver.resolve(workflow.outputs, (expression) =>
      this.#evaluate(context, expression),
    );
  }

  /**
   * Resolves a runtime expression leniently against a context, forwarding
   * `$components` / `$sourceDescriptions` resolution to the document and
   * registry — the workflow-scoped counterpart of {@link StepExecutor}'s bridge.
   */
  #evaluate(context: RuntimeExpressionContext, expression: string): unknown {
    return new RuntimeExpressionEvaluator(context, {
      strict: false,
      document: this.#document,
      registry: this.#registry,
    }).evaluate(expression);
  }
}

export default WorkflowExecutor;

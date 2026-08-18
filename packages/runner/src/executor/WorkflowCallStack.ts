import ExecutionError from '../errors/ExecutionError.ts';

/**
 * How a workflow invocation was entered.
 *
 * Recorded per call so a detected loop can be named for the mechanism that formed
 * it: a repeat reached purely through `dependsOn` edges is a dependency cycle,
 * one involving a sub-workflow step call — a `retry` action's `workflowId`
 * reference — or a `goto`'s one-way transfer to a `workflowId` — is a call
 * cycle. `retry` and `goto` are grouped with `step` for that classification, not
 * `dependsOn`: each is a call the current step makes, not a stated precondition.
 * @internal
 */
export type WorkflowCallVia = 'root' | 'step' | 'dependsOn' | 'retry' | 'goto';

/**
 * One workflow invocation in progress.
 */
interface WorkflowCall {
  readonly workflowId: string;
  readonly via: WorkflowCallVia;
}

/**
 * Options for the WorkflowCallStack.
 * @internal
 */
export interface WorkflowCallStackOptions {
  /**
   * How many workflows may be in progress at once. The count includes the
   * workflow at the root of the stack, so `1` permits that workflow and forbids
   * all nesting.
   */
  readonly maxDepth: number;
}

/**
 * The chain of workflow invocations in progress, as an immutable value.
 *
 * {@link WorkflowCallStack.enter} returns a *new* stack with the given workflow
 * pushed, or throws if entering it cannot be legitimate. Because entering yields
 * a new value rather than mutating this one, leaving is implicit: an unwinding
 * throw cannot leave a stale entry behind, and sibling calls each see only their
 * own chain — so a diamond (a workflow reached twice on separate paths, having
 * completed and unwound in between) is not a cycle, while a genuine re-entry is.
 *
 * Two distinct failures are guarded, in this order:
 *
 * - a **cycle** — the workflow is already in progress on this chain, so it can
 *   never terminate. Checked *first* deliberately: a cycle would eventually trip
 *   the depth ceiling too, but only after exhausting the whole budget of frames
 *   and then reporting the wrong cause.
 * - **excessive depth** — distinct workflows nested past `maxDepth`, which is
 *   legitimate nesting that simply has to be bounded.
 *
 * Both carry the offending `path`, since the workflow the error names is rarely
 * the one whose authoring needs looking at.
 * @internal
 */
class WorkflowCallStack {
  readonly #calls: readonly WorkflowCall[];
  readonly #maxDepth: number;

  constructor(options: WorkflowCallStackOptions, calls: readonly WorkflowCall[] = []) {
    this.#maxDepth = options.maxDepth;
    this.#calls = calls;
  }

  /**
   * The workflowIds in progress, outermost first.
   */
  get path(): readonly string[] {
    return this.#calls.map((call) => call.workflowId);
  }

  /**
   * Returns the stack with `workflowId` pushed, or throws when entering it would
   * form a cycle or exceed the nesting ceiling.
   */
  enter(workflowId: string, via: WorkflowCallVia): WorkflowCallStack {
    const repeated = this.#calls.findIndex((call) => call.workflowId === workflowId);
    if (repeated !== -1) {
      const path = [...this.path, workflowId];
      // name the loop for the mechanism that formed it: every edge closing the
      // cycle being a `dependsOn` edge makes it a dependency cycle, while any
      // sub-workflow step call in the loop makes it a call cycle. One stack
      // detects both, so a loop crossing the two mechanisms cannot slip between
      // them.
      const closingEdges = [...this.#calls.slice(repeated + 1).map((call) => call.via), via];
      const reason = closingEdges.every((edge) => edge === 'dependsOn')
        ? 'dependsOn-cycle'
        : 'workflow-cycle';
      throw new ExecutionError(
        `workflow "${workflowId}" is already in progress; its call chain forms a cycle (${path.join(' -> ')})`,
        { workflowId, reason, path },
      );
    }

    if (this.#calls.length >= this.#maxDepth) {
      throw new ExecutionError(
        `workflow "${workflowId}" nests deeper than the limit of ${this.#maxDepth} workflows`,
        { workflowId, reason: 'workflow-depth', path: [...this.path, workflowId] },
      );
    }

    return new WorkflowCallStack({ maxDepth: this.#maxDepth }, [
      ...this.#calls,
      { workflowId, via },
    ]);
  }
}

export default WorkflowCallStack;

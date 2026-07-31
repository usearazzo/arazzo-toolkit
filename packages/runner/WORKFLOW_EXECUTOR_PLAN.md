# WorkflowExecutor — implementation plan

Status: partially implemented. The backbone landed in PR `#290` (branch
`runner-workflow-executor`); the sections below are the full design, with an
implementation-status summary next. Grounds on the merged StepExecutor (`#279`)
and the Arazzo 1.0.1 spec (control-flow semantics quoted inline below). Target
spec: 1.0.1, same as StepExecutor.

## 0. Implementation status

### Shipped (PR `#290`)

- Core loop: iterate steps in list order, delegate each to `StepExecutor`,
  record step outputs into `WorkflowExecutionState` (`$steps.*.outputs` flow).
- Control-flow transitions: success default (`next`), `goto` a `stepId`, `end`
  (`status: 'ended'`), failure break-default (`status: 'failed'`).
- `maxSteps` runaway-goto guard (default 1000, throws `reason: 'step-budget'`).
- Workflow `outputs` resolved against the final run state.
- Workflow-level default `successActions` / `failureActions`: a step inherits
  them when it declares no `onSuccess` / `onFailure`; a step's own list
  **overrides wholesale** (no merge, success/failure independent — §7). Wired via
  a new optional `StepExecutor.execute` `defaultActions` arg + `ArazzoWorkflowExtractor`/
  `ActionResolver` type widening.
- Collaborator injection: `WorkflowExecutor` takes a `StepExecutor`;
  `StepExecutor` takes an `OpenAPIOperationExecutor` (its `clientFactory` moved
  down to that layer).
- Result shape: `{ workflowId, outputs, steps (per-step trace), status }`,
  read-only; run state fresh per `execute` call (reentrant).
- Authoring-error throws: `workflow-not-found`, `goto-target-not-found`,
  `goto-target-missing`, `unknown-action-type`, `step-budget`, `malformed-steps`
  (present but non-list `steps`, or a non-step entry).
- Fixture fix: dotted `$response.body.x` → JSON Pointer `$response.body#/x` in
  output/param values (criteria left on the simple-criterion grammar).

### Shipped (PR `#2` — retry)

- **Retry** (§6): `retry` failure actions re-run the step up to `retryLimit`
  (default 1) with a `retryAfter`-second delay, via an injectable `sleep`
  (`WorkflowExecutorOptions.sleep`, default real timer). Each attempt re-runs the
  operation and re-selects against the fresh response.
- **Exhaustion fall-through** (open question #5, resolved): honoring "retryLimit
  MUST be exhausted prior to executing subsequent failure actions", an exhausted
  retry advances to the *next* matching failure action — which may be another
  `retry` with its own **independent budget**, or a terminal `end` / `goto`; if
  none remains, the break-default applies. Implemented by having `StepExecutor`
  return **all** matching actions (`matchedActions`, via `ActionResolver.resolveAll`)
  and `WorkflowExecutor.#runStepWithRetry` walking that list — no re-evaluating
  criteria in the loop. `attempts` is surfaced in the `StepRunRecord` trace.
- A `retry` carrying a `stepId` / `workflowId` reference throws
  `reason: 'retry-reference-unsupported'` (see below).
- **`maxSteps` now counts operation executions**, charged once per attempt
  (retries included), so it bounds a runaway `retry` as well as a runaway `goto`
  — previously it only counted outer step entries, leaving retry unbounded. For
  retry-free workflows the count is unchanged (attempts == entries).

### Not yet implemented / missing

Each currently **throws `ExecutionError`** rather than misbehaving (or is simply
absent), and is scoped to a follow-up:

- **`retry` with a `stepId` / `workflowId` reference** (§6) — "the reference is
  executed and the context is returned, after which the current step is retried".
  Throws `reason: 'retry-reference-unsupported'`; lands with sub-workflow / goto
  support since it reuses that machinery.
- **Sub-workflow steps** (§4b) — a step targeting `workflowId` throws
  `reason: 'workflow-step-unsupported'`. Missing: the recursive call, sub-input
  mapping, `$workflows.<id>.outputs` population, depth guard. **Follow-up PR #3.**
- **Recursion / cycle detection** (§4c) — not present; deferred with sub-workflows.
  Missing: the per-run in-progress call stack (push/pop, not a monotonic set —
  diamonds must not false-positive), `workflow-cycle` (carrying the offending
  `path`) and `workflow-depth` errors. Design note: thread it per run, not on the
  instance (reentrancy); share the same structure with `dependsOn`.
- **`dependsOn`** (§5) — not present; run-to-completion ordering + cycle
  detection (`dependsOn-cycle`) via the shared call stack. Open question: output
  sharing semantics. **Follow-up PR #3.**
- **Step-level `goto` to a `workflowId`** (§4 note) — throws
  `reason: 'goto-workflow-unsupported'`; land once one-way-vs-return semantics
  are confirmed.
- **Cross-document workflow refs** — `$sourceDescriptions.<name>.<workflowId>`
  for sub-workflows / `dependsOn` not supported; would throw
  `reason: 'cross-document-workflow-unsupported'`. Same-document only for now.
- **Retry-reference target validation** — we intentionally do NOT validate the
  `stepId` / `workflowId` a reference-retry points at before throwing
  `retry-reference-unsupported`. Rejection is lazy (fire-time only, so an
  unreachable reference-retry never fails an otherwise-valid run), and validating
  the target belongs with the feature that consumes it, not its rejection:
  - a `workflowId` reference may be cross-document (`$sourceDescriptions.<name>.<id>`),
    so validating it needs the deferred cross-doc resolution above — can't be done
    in isolation;
  - a `stepId` reference *could* be checked cheaply against the current workflow
    (reusing `#indexOfStep`, same as `goto`), but validating only that half is a
    lopsided contract, and the author can't act on "valid target, still
    unsupported" anyway.
  So both land with reference-retry (which reuses the sub-workflow / goto-workflow
  machinery); until then the single `retry-reference-unsupported` throw is the
  contract.
- **Workflow-level `parameters`** (§7) — not implemented. Unlike actions, this is
  a genuine per-parameter merge (by name+in, step overriding); would follow the
  `defaultActions` pattern with a `StepExecutor` `additionalParameters` arg.
- **e2e suite** (§10) — only the deterministic stub unit suite exists; a real
  multi-step petstore run end-to-end is a separate opt-in follow-up.

## 1. Purpose & boundary

`WorkflowExecutor` is the loop that turns "run one step" into "run a workflow".
It is the **stateful orchestrator** that owns everything `StepExecutor`
deliberately refused:

- iterates a workflow's steps, calling `StepExecutor.execute(step, state, opts)`
  per step;
- **mutates** `WorkflowExecutionState` — records each step's resolved `outputs`
  (so later steps read `$steps.x.outputs.y`), sets workflow `outputs`;
- **interprets the returned `SelectedAction`** — the control flow StepExecutor
  only *selects* but does not act on: `goto`, `retry`, `end`, and the two path
  defaults;
- handles **`workflowId` steps** (sub-workflow calls) — the recursion
  `StepExecutor` throws on;
- applies **workflow-level defaults** (`successActions`/`failureActions`,
  `parameters`) that steps inherit;
- resolves workflow `inputs` and applies workflow `outputs`.

Dependency direction is one-way **today**: `WorkflowExecutor → StepExecutor`.
Sub-workflows are the WorkflowExecutor's *own* recursion (it calls itself), so
there is no cycle. This holds because StepExecutor deliberately refuses
`workflowId` steps — it **throws `reason:'workflow-step'`** rather than run a
workflow — and WorkflowExecutor intercepts those steps before they reach it
(§4b).

That refusal is a boundary of convenience, not a permanent law. A step whose
target is `workflowId` *is* a workflow invocation, so a future StepExecutor may
want to execute it directly instead of throwing. When that happens, StepExecutor
must **not** import `WorkflowExecutor` concretely (that would create a module
cycle) — it should depend on an injected port, e.g.:

```ts
interface SubWorkflowRunner {
  execute(workflowId: string, inputs?: Record<string, unknown>, executeOptions?: Record<string, unknown>): Promise<WorkflowExecutionResult>;
}
```

WorkflowExecutor implements that port and passes itself in. The compile-time
arrow still points one way (`StepExecutor → SubWorkflowRunner` interface ←
`WorkflowExecutor` implements it) while the runtime callback becomes possible.
Until then, the throw-and-intercept split above stands.

## 2. Public API

Mirror StepExecutor's option-bag constructor + per-call `execute`.

```ts
export interface WorkflowExecutorOptions {
  readonly document: ArazzoDocument;        // entry doc (source of workflows + $components/$sourceDescriptions)
  readonly registry: DocumentRegistry;      // loaded source docs
  readonly clientFactory: OpenAPIClientFactory;  // forwarded to StepExecutor
  // tunables with sane defaults:
  readonly maxSteps?: number;               // runaway-goto guard (default e.g. 1000)
  readonly maxWorkflowDepth?: number;       // sub-workflow recursion guard (default e.g. 16)
  readonly sleep?: (ms: number) => Promise<void>;  // injectable for retryAfter; default real timer, tests pass a no-op
}

export interface WorkflowExecutionResult {
  readonly workflowId: string;
  readonly outputs: Record<string, unknown>;        // workflow $outputs, resolved
  readonly steps: readonly StepRunRecord[];          // trace: what ran, in order, with outcomes
  readonly status: 'completed' | 'ended' | 'failed'; // ended = an `end` action fired; failed = a step broke-and-returned
}

export interface StepRunRecord {
  readonly stepId: string;
  readonly successful: boolean;
  readonly action: SelectedAction | undefined;
  readonly attempts: number;   // >1 when retried
}

class WorkflowExecutor {
  constructor(options: WorkflowExecutorOptions);
  execute(workflowId: string, inputs?: Record<string, unknown>, executeOptions?: Record<string, unknown>): Promise<WorkflowExecutionResult>;
}
```

Design choices (matching StepExecutor's established conventions):

- **`execute(workflowId, inputs, executeOptions)`** — caller names the workflow;
  WorkflowExecutor extracts + normalizes it (SRP: extraction/normalization is a
  detail of running a *named* workflow, unlike StepExecutor where the caller
  passed the already-extracted step — here the caller only has an id).
  - *Open question for review:* symmetry with StepExecutor (which takes a
    `step` element) would argue `execute(workflow, inputs)`. But a workflow is
    named by id and the executor must resolve `dependsOn`/sub-workflows by id
    anyway, so id-in is more natural. Leaning id-in.
- **Returns data, and also owns the state** internally — unlike StepExecutor
  (which mutates nothing), WorkflowExecutor *is* the mutation owner. It creates
  the `WorkflowExecutionState`, threads it through steps, and returns a
  read-only result. State is per-`execute` (per run), created fresh each call.
- **`executeOptions`** — the same opaque client bag, forwarded verbatim to every
  `StepExecutor.execute`.
- **Authoring errors throw** (missing workflow, `dependsOn` cycle, unknown
  `goto` target, recursion/step-count overflow); a step that legitimately
  fails-and-returns is a normal `status: 'failed'` result, not a throw — same
  split as StepExecutor.

## 3. Execution algorithm (the core loop)

Per spec §ordered "workflows are a list of steps executed in list order".

Shown as `#run` — the private recursive worker the public `execute` delegates
to, threading the `frame` (`callStack` + `depth`) per §4c.

```
#run(workflowId, inputs, executeOptions, frame):
  key = fq(workflowId); if frame.callStack.has(key): throw ExecutionError(reason:'workflow-cycle', path:[...frame.callStack, key])
  if frame.depth > maxWorkflowDepth: throw ExecutionError(reason:'workflow-depth')
  frame = { callStack: [...frame.callStack, key], depth: frame.depth + 1 }   # pushed for this run; unwinds on return
  workflow = extract + normalize workflow by id          # ArazzoWorkflowExtractor + ArazzoWorkflowNormalizer
  resolveDependsOn(workflow, frame)                      # §5, below — same frame
  state = new WorkflowExecutionState({ inputs })
  stepExecutor = new StepExecutor({ document, registry, clientFactory })
  steps = ordered list of workflow.steps
  index = 0
  stepCount = 0
  loop:
    if index >= steps.length: status = 'completed'; break
    if ++stepCount > maxSteps: throw ExecutionError(reason:'step-budget')   # runaway goto guard
    step = steps[index]
    outcome = await runStepWithRetry(step, state, executeOptions, workflow)  # handles retry internally
    record trace(outcome)
    if step is a workflowId step:                          # sub-workflow, see §4
       ... handled inside runStep (returns synthesized outcome)
    action = outcome.action                                # SelectedAction | undefined
    transition = interpret(action, outcome.successful, workflow)
    switch transition.kind:
      'next':      index += 1                              # success default OR goto resolved to next
      'goto-step': index = indexOf(transition.stepId)      # must be in current workflow
      'goto-workflow': await runSubWorkflow(transition.workflowId, ...); index += 1
      'end':       status = 'ended'; break
      'break':     status = 'failed'; break                # failure default (break and return)
  applyWorkflowOutputs(workflow, state)                    # resolve workflow.outputs against final state
  return { workflowId, outputs: state.outputs, steps: trace, status }
```

### Outputs recording (the key mutation)

After each step, `StepExecutor` already returns resolved `outputs`. The executor:

```
state.setStepOutputs(outcome.stepId, outcome.outputs)
```

so a later step's `$steps.{id}.outputs.{name}` resolves. This is the whole
reason StepExecutor returns data instead of mutating — the executor is the
single writer.

## 4. Action interpretation (`interpret`)

Spec-quoted semantics:

### Success (§Success Action Object): types `end`, `goto`
- **no matching onSuccess action** → default: `"the next sequential step shall
  be executed"` → `{kind:'next'}`.
- **`type: end`** → `"The workflow ends, and context returns to the caller with
  applicable outputs"` → `{kind:'end'}`.
- **`type: goto`** with `stepId` (MUST be in current workflow, mutually
  exclusive w/ workflowId) → `{kind:'goto-step', stepId}`.
- **`type: goto`** with `workflowId` → transfer control to another workflow →
  `{kind:'goto-workflow', workflowId}` (run it, then continue — see note).

### Failure (§Failure Action Object): types `end`, `retry`, `goto`
- **no matching onFailure action** → default: `"break and return"` →
  `{kind:'break'}` (status: failed).
- **`type: end`** → `{kind:'end'}`.
- **`type: retry`** → `"the current step will be retried"`. Retry is handled in
  `runStepWithRetry` (see §6), NOT here — by the time `interpret` sees a
  non-retry action, retries are exhausted or not requested. Semantics:
  `retryLimit` (default 1 if unset) attempts, `retryAfter` seconds delay
  between; a `retry` action MAY carry `stepId`/`workflowId` to execute *before*
  retrying (`"the reference is executed and the context is returned, after which
  the current step is retried"`). `"retryLimit MUST be exhausted prior to
  executing subsequent failure actions"` — so after exhaustion, we re-evaluate
  the *remaining* failure actions (the ones after the retry) for the final
  transition. **This is the subtlest bit — see §6.**
- **`type: goto`** (stepId/workflowId, mutually exclusive) → same as success
  goto.

`interpret` reads the `SelectedAction` element via the ns accessors already used
by `ActionResolver`: `toValue(action.type)`, `action.stepId`, `action.workflowId`,
`action.retryAfter`, `action.retryLimit`. Guard element presence with
`isStringElement` / `isNumberElement`.

**goto-workflow note (needs review):** the spec calls `goto` "a one-way transfer
of workflow control". Strict reading = control leaves the current workflow and
does not return. But a step-level `goto` to a workflow inside a running workflow
is ambiguous in 1.0.1. Safe initial behavior: treat step-level `goto-workflow`
as run-sub-workflow-then-continue (like a call), and flag the ambiguity — OR
throw "unsupported" until clarified. **Recommend: throw `reason:'goto-workflow-
unsupported'` initially** (mirrors how StepExecutor threw on `workflowId` until
we were ready), and implement once semantics confirmed. Sub-workflow *calls*
(step with `workflowId` field, §4-below) are the well-defined recursion path and
ARE supported.

## 4b. Sub-workflow steps (step.workflowId)

A step whose target is `workflowId` (not operationId/operationPath) is a
sub-workflow invocation — the case StepExecutor throws on
(`reason:'workflow-step'`). WorkflowExecutor intercepts these *before* calling
StepExecutor. (If StepExecutor ever stops throwing and runs these itself, it
does so via the injected `SubWorkflowRunner` port from §1, not a concrete
`WorkflowExecutor` import — this interception is the current mechanism, not a
permanent one.)

```
if isStringElement(step.workflowId):
   subInputs = resolve step.parameters/inputs against state           # map params → sub-workflow inputs
   subResult = await this.#run(subWorkflowId, subInputs, executeOptions, frame)   # RECURSION through #run; frame carries the stack → cycle+depth guarded (§4c)
   state.setWorkflow(subWorkflowId, { inputs: subInputs, outputs: subResult.outputs })
   state.setStepOutputs(step.stepId, resolve step.outputs against state)      # step can map sub outputs
   # then onSuccess/onFailure based on subResult.status, same as an operation step
```

- `workflowId` may be a `$sourceDescriptions.<name>.<workflowId>` runtime
  expression (cross-document) — resolve via the same mechanism the locator
  normalizer uses; initial version MAY support only same-document workflowIds
  and throw on cross-doc (follow-up), matching how we scoped operationId first.
- **Depth guard** (`maxWorkflowDepth`) bounds *legitimate* nesting depth.

## 4c. Recursion / cycle detection (call chain)

The depth guard alone is not enough. A workflow can reference itself through a
chain of sub-workflow steps — directly (A has a step that calls A) or indirectly
(A → B → A). This is a **cycle**: it never terminates. Bouncing off
`maxWorkflowDepth` after N frames would *mask* it as "too deep" and report the
wrong cause; a real cycle should be reported as a cycle, at the moment the
repeated workflow is re-entered — not N frames later.

Mechanism: maintain an **ordered in-progress workflow call stack** that spans the
whole recursion (threaded through `execute`, one per top-level run):

```
execute(workflowId, ...):
  key = fully-qualified id (doc + workflowId, so cross-doc same-named workflows don't collide)
  if callStack.has(key): throw ExecutionError(reason:'workflow-cycle', path: [...callStack, key])
  callStack.push(key)
  try { ...run steps, sub-workflow calls recurse through here... }
  finally { callStack.pop() }        # pop on the way out so siblings/diamonds (A→B, A→C→B) are NOT false positives
```

- **Cycle vs. depth**: `workflow-cycle` = the *same* workflow is already on the
  active call stack (guaranteed non-terminating); `workflow-depth` = distinct
  workflows nested past the budget (legitimate, just bounded). Distinct reasons,
  distinct diagnostics. The error carries the offending `path` (the chain
  A → B → A) so the author can see the loop.
- **Push/pop discipline matters**: a *set* alone would flag a diamond
  (A calls B and C, both of which call D) as a cycle. Popping on unwind means
  only workflows actually on the current active path count — a re-visit that has
  already completed and unwound is fine.
- **Shared with `dependsOn`**: this same in-progress stack is the one §5 uses for
  its cycle check, so a cross-mechanism loop (A `dependsOn` B, and B has a step
  that calls A) is caught by one mechanism. See §5.

**Ownership (decided): thread the stack as a parameter, not an instance field.**
The public `execute` stays clean and seeds a fresh stack; it delegates to a
private recursive method that threads the stack (and current depth) explicitly:

```ts
execute(workflowId, inputs?, executeOptions?): Promise<WorkflowExecutionResult> {
  return this.#run(workflowId, inputs, executeOptions, { callStack: [], depth: 0 });
}
// sub-workflow calls (§4b) and dependsOn (§5) recurse through #run, passing the
// extended frame — never through the public execute():
#run(workflowId, inputs, executeOptions, frame): Promise<WorkflowExecutionResult> { ... }
```

Rationale — an instance field would be simpler but is a reentrancy footgun: two
concurrent `execute(...)` calls on the *same* executor instance would share and
corrupt one field. A threaded parameter makes each top-level run's stack
independent by construction, costs nothing, and keeps the recursion self-evident
at the call site. The `frame` also carries `depth` so `maxWorkflowDepth` and the
cycle check travel together.

## 5. dependsOn

Spec: `"A list of workflows that MUST be completed before this workflow can be
processed."` Values are workflowIds (or `$sourceDescriptions.<name>.<id>`).

- Before running a workflow's steps, run each `dependsOn` workflow to completion
  first.
- **Cycle detection**: reuse the same in-progress workflow call stack as §4c —
  running a `dependsOn` workflow pushes onto (and pops off) the same stack, so a
  repeat is caught whether the loop is formed by `dependsOn` edges, sub-workflow
  step calls, or a mix of both. A pure-`dependsOn` repeat throws
  `reason:'dependsOn-cycle'`; a mixed/step-call repeat throws
  `reason:'workflow-cycle'`. (One shared stack, not two — otherwise a loop that
  crosses mechanisms slips through both checks.)
- *Open question:* are dependsOn outputs shared into the dependent workflow's
  state? Spec is thin. Initial: run them for their side effects / ordering, do
  NOT merge their outputs unless a `$workflows.<id>` reference needs it — but we
  DO `state.setWorkflow(id, {outputs})` so `$workflows.<id>.outputs` resolves.

## 6. Retry handling (`runStepWithRetry`) — the subtle part

Spec: `retryLimit` default 1, `retryAfter` seconds delay, and crucially
`"retryLimit MUST be exhausted prior to executing subsequent failure actions"`.

Algorithm:
```
runStepWithRetry(step, state, opts, workflow):
  attempts = 0
  loop:
    outcome = await stepExecutor.execute(step, state, opts)
    attempts += 1
    if outcome.successful: return {outcome, attempts}       # success ends retry loop
    action = selectFailureAction(step, workflow, outcome, state)   # incl. workflow-level defaults
    if action is retry AND attempts <= retryLimit(action):
       if action has stepId/workflowId: execute that reference first   # spec: "reference executed ... then retried"
       await sleep(retryAfter(action) seconds)              # Retry-After header overrules if present (future)
       continue                                             # retry the step
    return {outcome, attempts}                              # non-retry action, or retries exhausted
```

Then `interpret` runs on the returned outcome's action for the final transition.
After exhaustion, per spec we should evaluate the failure actions *after* the
retry action — this needs care: `ActionResolver` returns the *first* matching
action. To honor "retryLimit exhausted prior to subsequent failure actions", on
exhaustion we re-run action selection *excluding* the exhausted retry action, or
fall to the break default. **Flagging as the trickiest detail; propose a focused
design note + tests before implementing.**

`sleep` is injected (`WorkflowExecutorOptions.sleep`) so tests pass a no-op and
real runs delay. Default: `(ms) => new Promise(r => setTimeout(r, ms))`.

## 7. Workflow-level defaults (successActions / failureActions / parameters)

### successActions / failureActions — DONE (whole-list override, no merge)

Spec: workflow `successActions`/`failureActions` are `"applicable for all steps
... can be overridden at the step level"`.

**Decision (implemented): a step's own action list overrides the workflow-level
list wholesale — there is NO per-action merge.** A step that declares
`onSuccess` uses exactly that list; a step that declares no `onSuccess` inherits
the workflow's `successActions`. Success and failure fall back independently (a
step may override only `onFailure` and still inherit the workflow's success
actions).

- Earlier drafts of this plan proposed a by-`name` merge ("same name = override,
  new name = addition, workflow-only names always remain"). **That was rejected.**
  The spec says a step *overrides* the workflow default, not that the two lists
  union; whole-list override is the simpler, defensible reading and what we
  shipped. If a future spec clarification demands union semantics, revisit — but
  do not reintroduce name-merge speculatively.

How it's wired (as built):
- `StepExecutor.execute` gained an optional 4th arg
  `defaultActions: StepDefaultActions` (`{ onSuccess?, onFailure? }`, the
  workflow-level element lists). `#selectAction` selects from
  `step.onSuccess ?? defaultActions.onSuccess` (failure symmetric). No merge, no
  new helper — just `??`.
- `ActionResolver.resolve` was widened to also accept the workflow-level list
  element types (`WorkflowSuccessActionsElement` / `WorkflowFailureActionsElement`);
  they share the step lists' shape, so selection is unchanged.
- `WorkflowExecutor` resolves `workflow.successActions` / `workflow.failureActions`
  once per run and passes them as `defaultActions` to every step. Selection stays
  in StepExecutor because that is the only place with the post-response context.

### parameters — FUTURE (still a merge)

Workflow-level `parameters` remain out of scope for now. Unlike actions, the spec
intent here is genuinely additive/override at the individual-parameter level:
- **effective parameters** = merge(workflow.parameters, step.parameters) by
  parameter identity (name+in), step overriding.
  - *Wrinkle:* StepExecutor reads `step.parameters` directly. To feed merged
    params, either (a) WorkflowExecutor synthesizes a merged step element, or (b)
    StepExecutor gains an optional `additionalParameters` arg. **Prefer (b)** — a
    small, explicit StepExecutor extension mirroring the `defaultActions` arg
    already added — over mutating elements. Not yet implemented.

## 8. Reused building blocks (all already merged)

- `ArazzoWorkflowExtractor.extract(document, workflowId)` → WorkflowElement
- `ArazzoWorkflowNormalizer.normalize(workflow, document)` → dereferenced
- `ArazzoStepExtractor` — not needed for the main loop (we iterate
  `workflow.steps` directly), but used for `goto stepId` resolution
- `StepExecutor` — per-step engine. Extended with an optional `defaultActions`
  arg (§7, done); a future `additionalParameters` arg would follow the same shape
  for workflow-level params.
- `WorkflowExecutionState` — already has `setStepOutputs`, `setOutput`,
  `setWorkflow`, `outputs`, `toContext`. **Sufficient as-is.**
- `RuntimeExpressionEvaluator` — for resolving workflow `outputs`, sub-workflow
  input mapping, and `dependsOn`/`goto` runtime expressions. WorkflowExecutor
  needs its own evaluator bridge (like StepExecutor's `#evaluate`) for
  workflow-scoped expressions (outputs resolved against final state).
- `OutputResolver` — resolve workflow-level `outputs` map (reuse the same
  resolver StepExecutor uses for step outputs).

## 9. Errors

New `ExecutionError` reasons (extend the existing error type, no new class):
`workflow-not-found`, `workflow-cycle` (self-referential call chain, §4c),
`dependsOn-cycle`, `goto-target-not-found`, `goto-workflow-unsupported`
(initial), `step-budget`, `workflow-depth`,
`cross-document-workflow-unsupported` (initial).

`workflow-cycle` carries the offending `path` (chain of workflowIds, e.g.
A → B → A). Keep it distinct from `workflow-depth`: cycle = guaranteed
non-terminating (same workflow already on the active stack); depth = legitimate
nesting past the budget.

## 10. Testing strategy (stub client, deterministic — same as StepExecutor)

Unit suite `test/executor/WorkflowExecutor.ts` with the stub `OpenAPIClient`:
- linear workflow: steps run in order, outputs flow step→step via `$steps`
- success `goto stepId`: jumps correctly; loop terminates via step-budget guard
  on a deliberate infinite goto (assert it throws `step-budget`)
- `end` action: stops early, status `ended`, returns outputs so far
- failure default: step fails, no onFailure → status `failed`, breaks
- `retry`: fails N times then succeeds (stub returns 500 then 200); assert
  `attempts`, injected no-op `sleep` called with right delay; retryLimit default 1
- retry exhaustion → subsequent failure action / break
- workflow-level failureActions inherited by a step that declares no onFailure;
  a step's own onFailure overrides the workflow list wholesale (no merge);
  successActions symmetric — all DONE (§7)
- sub-workflow step (`workflowId`): recursion, `$workflows.<id>.outputs`
  populated, depth guard on legitimate deep (acyclic) nesting
- cycle detection (§4c): direct self-call (A→A) and indirect (A→B→A) both throw
  `workflow-cycle` with the offending `path`; assert it is reported as a cycle,
  **not** masked as `workflow-depth`
- diamond is NOT a false positive: A calls B and C, both call (completed) D →
  runs clean, no `workflow-cycle`
- cross-mechanism cycle: A `dependsOn` B, B has a step calling A → throws (one
  shared call stack catches it)
- `dependsOn`: ordering + pure-dependsOn cycle detection throws `dependsOn-cycle`
- workflow `outputs` resolved against final state
- `parameters` merge (workflow + step)

e2e (opt-in, separate follow-up PR, same as the StepExecutor e2e): a real
multi-step petstore workflow end-to-end.

## 11. Suggested PR slicing (keep each reviewable)

Given size, consider 2–3 PRs rather than one:
1. **Core loop + outputs + success/failure defaults + goto-step + end + break**
   (no retry, no sub-workflow) — the backbone.
2. **Retry semantics** (the subtle §6) — isolated, well-tested.
3. **Sub-workflow calls + dependsOn** (recursion, depth/cycle guards).
Cross-document workflow refs and step-level goto-workflow: throw initially, land
later once semantics confirmed.

## Open questions for review (decide before coding)

1. ~~`execute(workflowId, ...)` (id-in) vs `execute(workflow, ...)`
   (element-in)?~~ **RESOLVED: id-in.** Implemented.
2. Param merge via StepExecutor `additionalParameters` arg (preferred) vs
   synthesizing a merged step element? *(actions took the `defaultActions`-arg
   route in §7; params should follow it — still to build.)*
3. Step-level `goto` with `workflowId`: throw-initially (recommended) vs
   run-and-continue? *(shipped throw-initially: `goto-workflow-unsupported`.)*
4. dependsOn output sharing semantics — run-for-ordering only + expose via
   `$workflows`?
5. ~~Retry-exhaustion "subsequent failure actions" ordering — confirm the
   re-selection approach in §6.~~ **RESOLVED (PR #2):** `StepExecutor` returns
   *all* matching failure actions (`matchedActions`); the retry loop walks that
   list — retry-while-under-limit (each retry with its own budget), else advance
   to the next matching action, else break-default. No re-evaluating criteria in
   the loop; each attempt re-runs the operation and re-selects against the fresh
   response.

Note on runtime expressions vs. criteria (bit us while fixing fixtures): a value
in `outputs` / `parameters` / `requestBody` must be a *whole* runtime expression,
where member access is a JSON Pointer fragment (`$response.body#/id`) and array
length / indexing like `.length` / `[0]` is NOT expressible (needs JSONPath,
which Arazzo only allows in a criterion `context`, not in a value). A
`successCriteria` `condition` uses the *separate* simple-criterion grammar, which
DOES support JS-style `.length` / `[0]` / `.field` navigation — it resolves only
the embedded `$response.body` prefix and does the rest itself. Same-looking text,
two engines; don't "correct" dotted access inside a condition.

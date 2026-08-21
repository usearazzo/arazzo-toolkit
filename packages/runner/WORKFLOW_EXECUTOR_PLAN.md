# WorkflowExecutor — implementation plan

Status: the design below is implemented, across five PRs — the backbone
(`#290`), retry (`#2`), sub-workflow steps + `dependsOn` (`#3`),
cancellation (`#4`), and reference-retry — plus a train of follow-ups
(`#40`–`#61`, summarized in §0), goto-workflow transfer (issue `#65`), and
cross-document workflow references (issue `#64`). §0
tracks what shipped, what deliberately still throws, and **what to build
next**; the numbered sections after it are the design and its spec citations,
kept because the reasoning outlives the code. Grounds on the merged
StepExecutor (`#279`) and the Arazzo 1.0.1 spec (control-flow semantics quoted
inline below). Target spec: 1.0.1, same as StepExecutor. (Arazzo 1.1.0,
released 2026-05-17, leaves the `goto` wording quoted below unchanged — the
one-way-vs-return ambiguity this plan once flagged stood in both versions
before goto-workflow transfer resolved it as a working interpretation, per §0;
the retry-reference wording is likewise unchanged, but that ambiguity is also
resolved and shipped, per §0. 1.1.0's additions —
step-level `dependsOn` / `timeout`, AsyncAPI steps, new criterion types,
`querystring` already noted in issue `#33` — are out of this plan's scope.)

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
  retry advances to the _next_ matching failure action — which may be another
  `retry` with its own **independent budget**, or a terminal `end` / `goto`; if
  none remains, the break-default applies. Implemented by having `StepExecutor`
  return **all** matching actions (`matchedActions`, via `ActionResolver.resolveOnSuccess`/`resolveOnFailure`)
  and `WorkflowExecutor.#runStepWithRetry` walking that list — no re-evaluating
  criteria in the loop. `attempts` is surfaced in the `StepRunRecord` trace.
- A `retry` carrying a `stepId` / `workflowId` reference throws
  `reason: 'retry-reference-unsupported'` (see below).
- **`maxSteps` now counts operation executions**, charged once per attempt
  (retries included), so it bounds a runaway `retry` as well as a runaway `goto`
  — previously it only counted outer step entries, leaving retry unbounded. For
  retry-free workflows the count is unchanged (attempts == entries).

### Shipped (PR `#3` — sub-workflow steps + dependsOn)

Designed and implemented 2026-08-10, incorporating issues `#29`–`#33` (the
libopenapi comparison issues; source of `pb33f/libopenapi` `arazzo/` read
directly to verify the claims). The recursion slice from §11. Built on branch
`runner-sub-workflows-dependson`; 23 new tests in
`test/executor/WorkflowExecutorComposition.ts` against a new
`test/fixtures/workflow-composition.arazzo.yaml`, plus timing tests in the
existing suite.

**Delivered:**

- `execute` delegates to a private `#run(workflowId, inputs, scope, frame, via)`
  per §4c, with two threaded values rather than one (never on the instance —
  reentrancy):
  - `frame = { callStack, depth }` — the **per-call** position in the call tree,
    an immutable value rebuilt for each nested call, so unwinding is implicit;
  - `scope` — the **per-run** state every invocation in the tree shares: the
    caller's options plus the two mutable ledgers that must span it, `budget`
    and the completed-dependency map.

  The split is the point: sibling calls each get their own frame while all of
  them charge one budget, which is what makes the ceiling hold across the tree
  without giving up immutable call frames.

- **Shared budget across the tree** (issue `#29`, decided: global): the existing
  `budget` (step-attempt counter) moves into the shared run scope, so one
  `maxSteps`
  bounds the _whole_ recursion — a sub-workflow spinning on `goto`/`retry` must
  not get a fresh 1000. (libopenapi's is per-invocation — a local in
  `runWorkflow` — leaving a pathological tree unbounded overall; rejected.)
  Attribution is solved by data, not a second counter: the `step-budget` error
  carries the frame's `callStack` path alongside `workflowId`/`stepId`, so the
  overflow names the whole chain even when the counter trips in an innocent leaf.
- **Cycle + depth guards** (§4c, issue `#30`): ordered call stack keyed by
  fully-qualified workflow id; `workflow-cycle` (with `path`) on re-entry,
  `workflow-depth` past `maxWorkflowDepth` (new option, default 32 — matching
  libopenapi's constant, whose two-guard design — active set + depth, `defer`ed
  cleanup — independently confirms §4c). Diamonds and thrown sub-runs must not
  corrupt the stack; as built, the immutable per-call frame gives that for free
  rather than needing libopenapi's `defer` (see Deviations below).
- **Nested trace shape** (issue `#31`, decided: nested, NOT libopenapi's flat):
  `StepRunRecord.subWorkflows?: readonly WorkflowExecutionResult[]` — one entry
  per attempt that invoked the sub-workflow, in attempt order (an array because
  a retried `workflowId` step runs the sub-workflow once per attempt; a singular
  field would drop all but the last attempt's trace). `dependsOn` runs land as
  `WorkflowExecutionResult.dependencies?: readonly WorkflowExecutionResult[]`.
  Rationale: nested preserves identity (repeated invocations stay distinct),
  causality (parent step → its sub-run is a property access), and order; a flat
  view is derivable from nested via a trivial helper, never the reverse. Reading
  libopenapi's source settled it: their sub-run results go into an _internal_
  `state.workflowResults` map (last-write-wins by workflowId) that
  `RunWorkflow` never returns and `StepResult` cannot reference — sub-workflow
  traces are unreachable by their callers entirely. Not a shape to align with.
- **Timing** (issue `#32`, decided: include here while the result shapes are
  already changing): `durationMs` on `WorkflowExecutionResult` and
  `StepRunRecord` — a step's covers all attempts including `retryAfter` waits
  (documented as such; `attempts` already separates the axes). Clock injectable
  as `WorkflowExecutorOptions.now` (default `Date.now`), mirroring the `sleep`
  seam so tests stay deterministic.
- **Sub-workflow steps** (§4b): intercept `workflowId` steps before StepExecutor.
  - Sub-inputs: resolve `step.parameters` against the pre-step context — per spec
    a `workflowId` step's parameters carry no `in`, so they map by `name` to the
    sub-workflow's `inputs`.
  - Recurse through `#run` with the extended frame; then
    `state.setWorkflow(subId, { inputs, outputs })` so `$workflows.<id>.*`
    resolves; then resolve `step.outputs` against the updated state (no
    `$response` exists for such a step).
  - Outcome mapping: sub `status` `completed`/`ended` → success path, `failed` →
    failure path; onSuccess/onFailure then selected the normal way (incl.
    workflow-level defaults). To keep retry semantics uniform,
    `#runStepWithRetry` is generalized over an _attempt_ callback (operation
    attempt vs sub-workflow attempt) rather than duplicated — so a `retry` on a
    `workflowId` step just works, charged against the same budget.
- **`dependsOn`** (§5): before running steps, run each `dependsOn` workflow to
  completion through the same `#run`/frame (one shared stack ⇒ cross-mechanism
  cycles caught; pure-dependsOn repeat → `dependsOn-cycle`).
  - Inputs come from a caller-supplied **`dependencyInputs` map keyed by
    workflowId** (consulted for transitive dependencies too); a dependency with
    no entry runs with `{}` — fine for self-contained setup flows, and the only
    honest fallback since the spec gives `dependsOn` no input-mapping mechanism
    of its own (unlike sub-workflow _steps_, which map inputs via `parameters`).
    Without this channel, any dependency with required inputs is a guaranteed
    failure the caller cannot prevent. To house it, `execute` moves to an
    options-bag signature —
    `execute(workflowId, { inputs, executeOptions, dependencyInputs, runDependencies })`
    — a pre-1.0 reshape done once, which also gives `#28`'s `signal` its
    first-class home instead of reshaping the signature twice.
    - _Flat keying is sufficient by construction:_ memoization means a given
      workflowId runs at most once per `execute`, so there is never a second run
      for a nesting-dependent input set to attach to. That matches the
      semantics: `dependsOn` declares a _precondition_ ("completed before"), and
      a precondition satisfied twice with different inputs isn't well-defined.
      A workflow genuinely needed multiple times with different inputs is a
      parameterized invocation — the spec's tool for that is a sub-workflow
      _step_ with `parameters`, and docs should say so. (Cross-document
      same-named workflows: keys became fully-qualified when cross-doc support
      landed — `dependencyRuns` dedups on `{documentURI}#{workflowId}`, while
      `dependencyInputs` is keyed by the `dependsOn` entry as written; see §0
      "Shipped (cross-document workflow references)".)
  - **`runDependencies?: boolean`** (default `true`; a positive flag — an
    earlier `skipDependencies` draft read as a double negative when false):
    "completed before" doesn't mean _completed by this engine in this run_ — a
    dependency may have been satisfied out-of-band (a previous `execute`,
    yesterday's provisioning), and re-running it can be harmful (duplicate side
    effects). The engine can't detect external satisfaction, so
    `runDependencies: false` is the caller asserting it — for the workflow they
    name only, since a sub-workflow's prerequisites are an implementation detail
    they may not know exists, and skipping those on their behalf would run it
    against state nobody prepared. Documented caveat:
    opting out populates no `$workflows.<depId>.outputs`, so expressions reading
    dependency outputs resolve `undefined` — the caller owns that trade when
    asserting the precondition.
  - Record via `state.setWorkflow` (resolves open question #4: run for
    ordering/side effects, expose outputs via `$workflows`, no merging), and in
    the result's `dependencies` trace.
  - A **failed dependency** fails the run: parent returns `status: 'failed'`
    with an empty step trace (it's a runtime failure, not an authoring throw).
  - **Per-run completed set** for dependsOn only: a dependency already completed
    in this run is not re-run (diamond deps would otherwise duplicate HTTP side
    effects); sub-workflow _step calls_ are calls and always run.
  - _Interpretation note (spec ambiguity, decided):_ "MUST be completed before
    this workflow can be processed" doesn't say whose job that is. libopenapi
    reads it as a **batch-scheduler constraint**: its `RunAll` topologically
    sorts every workflow in the document (each run once, with its own inputs),
    while its single-workflow `RunWorkflow` ignores `dependsOn` entirely. We
    read it as a **prerequisite the engine satisfies on demand** (make-style):
    `execute(id)` runs the declared dependencies first — an engine that runs a
    workflow while skipping what its document says MUST complete first isn't
    honoring the document. Cost of our reading: implicit dependency runs have
    no spec-defined input channel — hence the caller-supplied `dependencyInputs`
    map above. A future `executeAll()` is the natural home for libopenapi-style
    batch semantics.

**Out of scope (still throwing, unchanged reasons):** step-level goto-workflow;
cross-document workflow refs (including one named by a `retry` reference).
Workflow-level `parameters` and the e2e suite remain separate follow-ups.
(Reference-retry, step-level goto-workflow, and cross-document workflow refs,
all listed here at the time this PR shipped, are now under "Shipped" below —
nothing from this list remains open.)

**Deviations from the design above, as built:**

- `durationMs` is **required**, not optional, on both result types — it is always
  produced, so optionality would only have forced needless narrowing on
  consumers.
- `StepExecutor.#selectActions` became **public** `selectActions`. A
  sub-workflow step never reaches `StepExecutor.execute` but still needs its
  actions selected under the same override/fallback rules (§7); exposing the one
  implementation beats duplicating those rules in the orchestrator.
- The call stack records **how** each frame was entered (`root` / `step` /
  `dependsOn`) so a detected loop can be named for the mechanism that formed it:
  every edge closing the loop being a `dependsOn` edge yields `dependsOn-cycle`,
  any step call in the loop yields `workflow-cycle`. §5 asked for the
  distinction without saying how to tell them apart.
- No `try`/`finally` push/pop. The frame is an immutable value rebuilt per call,
  so unwinding is implicit and a throwing sub-run cannot leave a stale entry —
  the property libopenapi needs its `defer` for.
- A sub-workflow step attempt charges the budget **1 for the step itself** plus
  whatever its sub-run spends. Slight over-count against pure HTTP calls, but it
  keeps a `goto` loop over a step calling an empty workflow bounded. The
  `step-budget` message now says "step attempts" rather than "operation
  executions" to match.
- A step declaring `workflowId` alongside `operationId` / `operationPath` throws
  `ambiguous-target` from the workflow executor (StepExecutor makes the same
  check, but a sub-workflow step no longer reaches it).
- New reason `malformed-dependsOn` (present but non-list `dependsOn`, or a
  non-string entry), mirroring `malformed-steps`.
- A sub-workflow step's `successCriteria` are evaluated too — `successful` is
  the sub-run not having failed **and** the step's criteria passing. Neither the
  plan nor §4b said so, and the first implementation dropped them, silently
  discarding an author's assertion (caught in review). `StepExecutor.evaluateCriteria`
  went public alongside `selectActions` for the same reason.
- `dependsOn` prerequisites run _after_ `steps` is validated, so a malformed
  workflow throws before any prerequisite fires live requests.
- Three collaborators were extracted from `WorkflowExecutor` after the feature
  landed, on the line "rule systems out, orchestration in" — the executor keeps
  the loop, the recursion and state writing, and delegates the three rule
  systems that each have their own vocabulary. Together they took it from 944
  lines (485 code) to ~700 (~340), and bought 35 tests for rules previously
  reachable only by authoring a YAML fixture and driving it through a stub
  transport:
  - `StepRetryRunner` — the retry algorithm (per-action budgets keyed by element
    identity, exhaustion fall-through, `retryAfter`). Driven by an attempt thunk,
    so it knows nothing of steps; a caller charging a run budget does it inside
    that thunk, so it knows nothing of budgets either.
  - `WorkflowCallStack` — the chain of in-progress workflows as an immutable
    value guarding its own invariants, so cycle and depth rules sit with the data
    they constrain and unwinding needs no `try`/`finally`.
  - `StepTransitionInterpreter` — §4's Success/Failure Action semantics as a pure
    mapping from action to transition. The weakest of the three on its own terms:
    no state and no invariant to protect, and a module-level exported function
    would have given the same testability. Kept as a class for consistency with
    its two siblings and with the package's other stateless collaborators
    (`ActionResolver`, `OutputResolver`, `CriterionEvaluator`), not out of
    necessity — step-level goto-workflow (shipped, see §0 "Shipped
    (goto-workflow transfer)") landed in this code, and under "policies out,
    orchestration in" arrived exactly as predicted: another `Transition` kind
    that the executor acts on, which a function would have served equally
    well. Downgrading the class to one later is still a small change that
    keeps its tests.
- A `retry` on a sub-workflow step re-runs that workflow's **steps**; its
  already-completed `dependsOn` prerequisites stay satisfied, since the
  completed-dependency memo spans the run. Retrying re-runs the work, not the
  preconditions — the alternative would reintroduce exactly the duplicate side
  effects the memo exists to prevent.

**Tests:** the §10 list rows covering sub-workflows, cycles (direct, indirect,
diamond-negative, cross-mechanism), depth, dependsOn ordering + cycle +
failed-dependency, shared budget across the tree (and the budget error carrying
the callStack path), retry on a `workflowId` step; trace shape: two steps
calling the same sub-workflow yield two distinct nested results, a retried
`workflowId` step yields one `subWorkflows` entry per attempt; `durationMs`
asserted exactly via an injected `now`; `dependencyInputs` feeds a dependency
(and a transitive one), `runDependencies: false` runs no deps and leaves
`$workflows.<depId>` unresolved.

### Shipped (PR `#4` — cancellation / `AbortSignal`)

Issue `#28`, the head of the queue below. Cancellation was wire-deep before
this: a `signal` smuggled through the opaque `executeOptions` bag reached the
transport, so the request in flight was aborted — but the loop above it neither
accepted nor observed one, so an aborted run went on to execute every remaining
step, each aborted request judged by `successCriteria` as if the API had
refused.

**Delivered:**

- `signal` is a first-class `WorkflowExecuteOptions` field (and a recognized
  `#EXECUTE_OPTION_KEYS` key, so a typo still fails loudly). It is spread into
  the `executeOptions` bag on its way down — that bag is how anything reaches
  the transport. The bag remains a valid channel in its own right: a `signal`
  passed only there is absorbed into the run scope at `execute`, so it gates
  every boundary rather than just the dispatch, and the first-class option wins
  when both are given. Read at the run boundary rather than at each dispatch,
  the pre-option idiom cancels a whole run instead of half of one.
- Observed at every boundary in the call tree: entering a workflow (so a
  sub-workflow call or the next `dependsOn` prerequisite is not started), before
  every step attempt, and on the way out of a workflow — nothing follows the
  last step, so without that closing check a run abandoned while it was in
  flight would resolve as though the caller had waited for it, and only under a
  transport that ignores the signal. The error names where the run _was_ rather
  than where it was heading: the deepest frame in progress reports it, and a
  cancellation surfacing from inside a step is re-raised by the calling
  workflow, which adds the workflowId and call chain the step executor has no
  way to know. The per-attempt check rides the same seam as the
  budget charge, inside the thunk handed to `StepRetryRunner`, so it covers the
  boundary between two steps and between two attempts of one step alike.
- `StepRetryRunner`'s `sleep` takes the signal (`(ms, signal?)`); the default
  timer clears itself and returns early on abort rather than sitting out a long
  `retryAfter`, and removes its listener when the wait ends normally so a
  long-lived signal accumulates nothing. It resolves rather than rejects:
  turning an abort into an error stays the caller's job, as with the budget —
  the signal reaches the runner only because a wait already in progress cannot
  be cut short from inside the attempt thunk. An injected
  sleep that ignores the signal is not wrong — it merely postpones the
  cancellation until its wait ends (asserted in the tests).
- `StepExecutor` honors a `signal` in its execute options on its own account,
  checked immediately **before dispatch** rather than on entry: locating the
  operation and resolving the expressions are awaited, so an entry-only check
  would still issue a request nobody is waiting for, whose wire-level
  cancellation surfaces as a transport `ClientError` rather than as the
  withdrawal it is.
- A request the transport drops mid-flight is reported as the abort, not as the
  `ClientError` reserved for a request that failed on its own terms: a
  signal-honoring transport (fetch, axios, undici) rejects what it was told to
  drop, and without this the same cancellation would read one way when it landed
  between two steps and another when it landed in flight — per transport, since
  a transport ignoring the signal produces neither. Only an aborted signal
  reinterprets a transport error; a genuine failure stays a `ClientError`.
- **Shape (the open decision, settled):** an aborted run **throws**
  `ExecutionError` with `reason: 'aborted'`, naming the boundary (`workflowId`,
  `stepId`, `path`) and carrying the signal's own `reason` as `cause`. Not a
  `status: 'aborted'` result: cancellation is not a workflow outcome — nothing
  was judged, no failure action was consulted, and the steps that did not run
  were not decided against — and a fourth status would let a caller mistake a
  withdrawn run for one the API answered. The partial trace is _not_ attached;
  that stays open, and adding it to the error later is compatible in a way a new
  result status would not have been.
- Shared internals in `src/executor/abort.ts` (`throwIfAborted`,
  `readAbortSignal`), unexported from the barrel. The signal is duck-typed out
  of the bag rather than `instanceof`-checked, so one made in another realm (a
  worker, a polyfill, a test harness) still cancels the run. The abort context
  carries the call **stack**, not its `path`: that getter rebuilds an array per
  access, and the check sits in the per-attempt loop, so the chain is
  materialized only on the way out.

**Client-agnostic by construction:** every check above is executor-level and
touches no transport. Only cancelling the request _already on the wire_ is the
transport's job, and the `HTTPClient` contract already asks for it ("honor
`request.signal` when present"). A transport that ignores it costs one in-flight
request; the run still stops at the next boundary.

**Tests:** 21, across four suites. `WorkflowExecutor`: a pre-aborted signal
starts nothing (`path: ['linear']`, zero calls), an abort mid-request stops at
the next step, an abort stops between two retry attempts (the injected sleep,
which ignores the signal, still waited once), `cause` carries the abort reason,
a live signal reaches the request, a signal passed only in
`executeOptions` cancels the run all the same, and the first-class option beats
one in the bag. Composition: an abort before the next prerequisite
(`path: ['dependent', 'setupB']`) and before the next sub-workflow call.
`StepRetryRunner`: the injected sleep is offered the signal, and the _real_
timer cuts a 5s `retryAfter` short (asserted on elapsed time, so a regression
fails rather than hangs). `StepExecutor`: an aborted signal throws with nothing
reaching the transport; a live one reaches the request; a transport that rejects
the request it was told to drop surfaces as `aborted`, while the same rejection
without a cancellation stays a `ClientError`. A bag value that is not a usable
signal is ignored rather than taken for a cancellation.

### Shipped (follow-up PRs `#40`–`#61`)

Fixes and refactors after the four feature PRs, recorded here because two of
them moved semantics this plan had placed elsewhere:

- **Workflow-level `parameters` (§7, open question #2 — resolved differently
  than the plan leaned):** shipped in `#40` as inheritance in
  `ArazzoWorkflowNormalizer`, NOT via the `additionalParameters` arg §7
  preferred — normalization-time inheritance mirrors how the OpenAPI
  normalizers fold a Path Item's parameters into an Operation. Identity is the
  `(name, in)` pair with an absent `in` equal only to another absent `in` (a
  `workflowId` step's inputs are keyed by name alone and must stay
  overridable); the step's own parameters lead the merged list. `#42` then made
  `ParameterResolver` deliver by the same `(name, in)` identity.
- **Actions inheritance moved to the normalizer too (`#49`):** the
  `defaultActions` wiring §7 records as "as built" is gone — the normalizer
  copies workflow `successActions` / `failureActions` into each step that does
  not declare the corresponding key (`hasKey`, so an explicit `onSuccess: []`
  still suppresses the default), and `StepDefaultActions`, the fourth
  `StepExecutor.execute` / `selectActions` parameter, and `ActionResolver`'s
  workflow-typed arms were removed. Action elements are shared, not cloned, so
  retry budgets keyed by element identity behave as before.
- **Hardening:** malformed `parameters` / actions lists report as typed errors
  (`#51`), as does a malformed `onSuccess` / `onFailure` / `criteria` entry
  (`#59`); a thrown `ResolverError` is attributed to its step or workflow
  (`#57`); a scalar `requestBody` no longer silently sends no body (`#56`);
  workflow-level `outputs` shape is validated up front, before prerequisites or
  steps fire live requests (`#53`/`#61`).
- **`ActionResolver.resolveAll` split** into `resolveOnSuccess` /
  `resolveOnFailure` (`#60`).
- **Filed as follow-up:** issue `#39` — move the parameter-inheritance rule
  into a `normalize-parameters` refractor plugin in
  `@speclynx/apidom-ns-arazzo-1`, consumed here the way the OpenAPI
  normalizers consume theirs. Cross-repo: blocked on an apidom release. (Its
  "out of scope" note predates `#49` by two hours — actions now also live in
  the normalizer, though as local code, not the plugin.)

### Shipped (reference-retry)

Issue `#62` (input channel for a `workflowId` reference) filed alongside as a
tracking issue, not a blocker — see below. Design proposed and reviewed
2026-08-17 (§0 "Next" §1, superseded by this subsection); implemented the same
day. All five PROPOSED decisions from that design shipped as proposed —
frequency (once per firing), ordering (sleep → reference → retry), the
reference's own control flow not followed, a failed reference not breaking the
chain, and lazy target validation.

- **Seam, as built:** `StepRetryRunContext` gains an optional
  `runReference?: (action: FailureActionElement) => Promise<void>`.
  `StepRetryRunner` still does not inspect `stepId`/`workflowId` itself —
  `#referenced(action)` only detects *that* a reference is present; a referenced
  action with no `runReference` supplied still throws the standalone
  `retry-reference-unsupported` (fail-fast, before the `retryAfter` sleep,
  unchanged from before this PR). With a callback supplied, the reference runs
  after the sleep and before `continue`, and a throw from it propagates exactly
  like a throw from the attempt thunk — ending the step, not retried around.
- **`WorkflowExecutor` supplies the callback** (`#retryReference`), built once
  per step and threaded into every `StepRetryRunner.run` call for that step:
  - a `workflowId` reference runs through `#run` with the current frame's
    `callStack`, entered via a new `'retry'` `WorkflowCallVia` — grouped with
    `'step'` for cycle classification (a reference is a call the retrying step
    makes, not a stated precondition), so a loop closed through one reports
    `workflow-cycle`. It runs with **`{}` inputs**: the spec gives a retry
    reference no input-mapping mechanism (the same gap `dependsOn` has), and
    `{}` is the only spec-honest fallback — tracked, not blocked, by issue
    `#62`, which weighs extending `dependencyInputs` or a dedicated
    `referenceInputs` option if real flows need it. Its outputs are recorded
    via `state.setWorkflow`, the same call `#runDependencies` makes — this
    recording *is* "context transfers back". Cross-document
    (`$sourceDescriptions.*`) reused the then-existing
    `#rejectCrossDocumentWorkflow` and threw
    `cross-document-workflow-unsupported` (since resolved — such a reference
    now runs; see §0 "Shipped (cross-document workflow references)").
  - a `stepId` reference is looked up in the current workflow's `steps` via
    `StepTransitionInterpreter.indexOfStep`, **parameterized** with an optional
    `{ reason, label }` descriptor (defaulting to `goto-target-not-found` /
    "goto target") rather than duplicated — a miss throws the new
    `retry-target-not-found`, named for the missing target (matching the
    existing `goto-target-not-found` convention: the error's `stepId` field is
    the target, not the calling step). Found, it runs through the same
    `#stepAttempt` + a new shared `#chargedAttempt` wrapper (factored out of
    the main loop's per-attempt closure — budget charge, abort check before and
    after) the step's own attempts use, so it is charged, cancellable, and — if
    the target itself is a `workflowId` step — recurses the normal way with no
    special case. Its outputs are recorded via `state.setStepOutputs`. A
    self-reference (a step's retry naming its own `stepId`, e.g. the
    pre-existing `retryWithReference` fixture) needs no special case either: it
    is just one more attempt at that step.
- **Trace:** new public `RetryReferenceRecord` (`{ kind: 'step' | 'workflow',
  id, successful, subWorkflow? }`), one per firing, on a new optional
  `StepRunRecord.retryReferences` field — kept separate from `subWorkflows`
  because a reference belongs to the *retry*, not to the step's own target.
  `subWorkflow` carries the nested run when the reference invoked a workflow,
  whether directly (`kind: 'workflow'`) or because a referenced step itself
  targets one (`kind: 'step'`).
- **Budget:** a `stepId` reference charges one step-attempt (via
  `#chargedAttempt`, same as any step); a `workflowId` reference charges only
  what its sub-run spends — matching the sub-workflow-step convention §0
  already records ("1 for the step itself plus whatever its sub-run spends").
- `retry-reference-unsupported` now means specifically "a referenced retry
  action was run through `StepRetryRunner` directly, with no `runReference`
  supplied" — `WorkflowExecutor` never triggers it anymore; the standalone
  unit test for it (`StepRetryRunner.ts`) is the only place it still fires.

**Tests:** 5 unit tests on `StepRetryRunner` (once-per-firing not
once-per-chain, sleep-then-reference ordering, no call for a reference-free
retry, no call once exhausted, a throwing callback propagates and halts);
6 `WorkflowExecutor` tests (self-reference — failed reference doesn't break the
chain; a repair-step scenario proving the next attempt reads the reference's
outputs; missing `stepId` target; a `workflowId` reference running to
completion with its outputs reachable via `$workflows`; budget charged for the
reference specifically; abort during the `retryAfter` wait stops before the
reference runs at all); 1 `WorkflowExecutorComposition` test (a cycle closed
through a `workflowId` reference classifies as `workflow-cycle`, confirming
`'retry'` groups with `'step'` for that purpose).

### Shipped (goto-workflow transfer)

Design proposed in [issue #65](https://github.com/usearazzo/arazzo-toolkit/issues/65)
(semantics decided 2026-08-17, result shape proposed the same day, both
citing [OAI/Arazzo-Specification#66](https://github.com/OAI/Arazzo-Specification/issues/66));
implemented as proposed. Formerly §0 "Next" item 1, formerly §4's
goto-workflow note (both superseded by this subsection).

- **Semantics, as built: one-way, no return.** A `goto` naming a `workflowId`
  ends the calling workflow's own run at that step — it does not resume
  afterward, and its own `outputs` declaration is never evaluated (the run
  never reaches its own end). Basis unchanged from the proposal: the
  `stepId`/`workflowId` field descriptions condition "context transfers back
  upon completion" on `retry` specifically; the scoping is the signal that
  `goto` does not return.
- **`StepTransitionInterpreter` gains a `transfer` `Transition` kind**
  (`{ kind: 'transfer', workflowId }`), replacing the
  `goto-workflow-unsupported` throw. A `goto` naming both `stepId` and
  `workflowId` now throws `ambiguous-target` — unreachable before (the
  `workflowId` branch threw unconditionally), needed once it returns a
  transition instead, mirroring the same check `#retryReference` already
  makes.
- **`WorkflowExecutor`'s `#run` loop acts on `transfer`** via a `switch` over
  `Transition['kind']` (labeled `stepLoop:`, since exiting the transfer/`end`/
  `break` cases must break the *loop*, not just the switch) — a `default`
  branch narrows the exhausted union to `never` and throws `ExecutionError`
  (`reason: 'unknown-transition-kind'`) rather than a bare `Error`, matching
  the codebase's own exhaustiveness-guard convention
  (`CriterionEvaluator`/`RuntimeExpressionEvaluator`). The transfer case
  checks for cancellation **before** rejecting a cross-document target
  (matching the boundary-check-first convention every other nested call
  follows; the rejection has since become *resolution* — same ordering, see
  §0 "Shipped (cross-document workflow references)"), then runs the target
  through a new shared
  `#runReferencedWorkflow` helper — entered via a new `'goto'`
  `WorkflowCallVia`, grouped with `'step'`/`'retry'` for cycle classification,
  on the *caller's* call stack (push-only, so a self-transfer is caught as
  `workflow-cycle`, not allowed as a "real" tail call). Runs with **`{}`
  inputs** — a `goto` action carries no parameters, the same gap issue `#62`
  already documents for a retry's `workflowId` reference. **Not charged
  against the step budget** on entry, unlike a retry reference: a `goto`
  fires once per step evaluation, with no way to re-fire from the same frame
  the way `retryLimit` lets a reference fire repeatedly, so
  `maxWorkflowDepth` + cycle detection already bound a transfer chain without
  a third guard.
- **`#runReferencedWorkflow(refId, workflowId, stepId, scope, callStack, via)`**
  — shared by the transfer branch and `#retryReference`'s own `workflowId`
  branch, which otherwise repeated the identical "reject a cross-document
  target, then run with `{}` inputs" sequence. Also closes a gap neither copy
  had on its own: a target this document does not define now throws
  `workflow-not-found` naming the *calling* `stepId` (previously, both paths
  fell through to `#resolveWorkflow`'s own generic `workflow-not-found`,
  which — reached from every kind of nested call, not just these two — carries
  no caller context at all, so several `goto`s to the same missing id were
  indistinguishable). `StepTransitionInterpreter` gains a matching
  `actionTargets(action)` helper, sharing the `hasStepId`/`hasWorkflowId`
  detection between `goto`'s own ambiguous-target check and
  `#retryReference`'s.
- **Result shape, as built:** new terminal `status: 'transferred'` (added to
  `WorkflowExecutionResult['status']`), new optional
  `transferredTo?: WorkflowExecutionResult` nesting the target's full result —
  never spliced in, so `workflowId` on the transferred result stays the
  workflow that was *called*, and a chain reads back via
  `transferredTo.transferredTo`, recursively, with no special-casing — and a
  new **required** `settledStatus: 'completed' | 'ended' | 'failed'`, present
  on every result, not only transferred ones (see next bullet). The caller's
  own `steps` keeps its partial trace up to the transfer; its top-level
  `outputs` is always `{}`.

  `#run` assembles these from a single `RunOutcome` value
  (`{ kind: 'settled', status } | { kind: 'transferred', transferredTo }`)
  rather than a `status` string plus a separately-set `transferredTo` local —
  an earlier revision of this change had exactly that shape, with the
  transfer branch setting both, and review during implementation flagged it:
  nothing but convention kept them in sync, and a future branch could set one
  without the other and compile fine. `RunOutcome` makes that state
  unconstructable rather than merely discouraged; `#result` switches on its
  `kind` once and derives `status`, `settledStatus`, whether `outputs` gets
  resolved, and whether `transferredTo` is present, all from that one value.
- **`settledStatus`, computed eagerly, not chased on read.** The original
  design here exported a `settledResult(result)` function that walked
  `transferredTo` at query time to answer "did this settle failed?" — correct,
  but opt-in: nothing stopped a consumer writing the natural-looking
  `result.status === 'failed'` and getting a silently wrong answer, since nothing
  in the type system flags an incomplete comparison against a 4-variant union
  the way an unhandled `switch` case would. Review during implementation (this
  time from the human maintainer, comparing the export against "a structure
  that abstracts this for us") led to computing the settled verdict once, at
  construction, into a field every result already carries — `transferredTo`
  (built first, bottom-up through the recursion) already has its own
  `settledStatus`, so a transferred result's is `O(1)`:
  `outcome.transferredTo.settledStatus`, not a walk. `settledResult(result)`
  is kept, exported, for the different job of retrieving the terminal result
  *itself* (its `outputs`, `steps`, `workflowId`) — for the verdict alone,
  `result.settledStatus` needs no call. Used **at the four places a nested
  run's outcome gates something the caller does next** — the dependency gate,
  the `#runDependencies` short-circuit, a retry-reference's recorded
  `successful`, and a sub-workflow step's own success determination — via a
  private `#settledFailed(result)` reading `result.settledStatus === 'failed'`
  directly. A `'transferred'` result is a record of *where* control went, not
  itself a verdict; judging by the raw status would either read a chain that
  settled `failed` as success (`!== 'failed'` literal) or punish one that
  settled `completed` (treating `transferred` as failure outright). The
  nested run's own identity (`workflowId`) and `outputs` (`{}`) are still
  recorded as the *called* workflow's own — only the pass/fail judgment is
  chased through the chain. One consequence worth naming: a `dependsOn`
  prerequisite whose chain settles non-`failed` is memoized as satisfied even
  though its own result reads `'transferred'`, the same as any other
  non-`failed` dependency. **This matters on the top-level `execute()` result
  a library consumer receives, not only on nested ones**: it can itself be
  `'transferred'` with a chain that settles `'failed'` underneath, and
  `result.status === 'failed'` would silently miss that — `result.settledStatus`
  is the field that reflects where the run actually landed, present and cheap
  to read on every result, transferred or not.

**Tests:** 3 `StepTransitionInterpreter` unit tests (transfer from either
path; ambiguous stepId+workflowId; `actionTargets` covered indirectly through
both); 11 `WorkflowExecutor` tests (happy path incl. never-evaluated outputs,
`{}` target inputs, and `settledStatus`; a two-hop transfer chain with
`settledStatus` at each hop and `settledResult` chasing the terminal result;
`settledResult` returning a non-transferred result unchanged with
`settledStatus` mirroring `status`; transfer from the failure path;
ambiguous-target; unknown target naming the calling step; cross-document
target; an abort at the transfer boundary reported as `aborted` even for a
cross-document target; no step-budget charge on entry; abort at the transfer
boundary never enters the target; a top-level result whose chain settles
`'failed'` detected via `settledStatus` despite reading `'transferred'` at the
top); 8 `WorkflowExecutorComposition` tests (self-transfer as
`workflow-cycle`; indirect transfer cycle; transfer chain bounded by
`maxWorkflowDepth`; a sub-workflow step reading a transferred target's
`settledStatus`, both completed and failed; a `dependsOn` prerequisite read
the same way, both completed and failed; a retry-workflowId reference's
`successful` reflecting the `settledStatus` of a target that itself
transfers).

### Shipped (cross-document workflow references — issue `#64`)

`$sourceDescriptions.<name>.<workflowId>` now resolves and runs in all four
author-facing positions — a sub-workflow step's `workflowId`, a `dependsOn`
entry, a retry's `workflowId` reference, and a `goto`'s transfer.
`#rejectCrossDocumentWorkflow` and `reason:
'cross-document-workflow-unsupported'` are **gone**. The design change this
section's predecessor analyzed (document scoping in the executors) landed as
follows:

- **`ArazzoWorkflowLocator { document, workflowId }` is the canonical form**
  every reference — plain id or expression — normalizes to, mirroring
  `OpenAPIOperationLocator`. A new public `ArazzoWorkflowLocatorNormalizer`
  (registry in the constructor, referencing document per call, like its
  OpenAPI sibling — both now extend an `@internal`
  `SourceDescriptionsLocatorNormalizer` base owning the registry handle and
  the one grammar-facing `$sourceDescriptions` parse) exposes **one** public
  method: `normalize(reference, document, context) → locator`. Its two
  halves — the sync parse (anything `$`-prefixed that is not a
  `SourceDescriptionsExpression` throws `invalid-workflow-reference`,
  including the resolver package's `#/workflows/...` pointer form, a
  `$ref`-time construct, not a runtime expression) and the async resolve
  (`resolveSourceDescriptionURI` → `source-description-not-found`;
  `registry.acquire` → `ArazzoDocument.is`, never the declared `type:` →
  `source-description-not-arazzo`) — are `#`-private. Callers needing the
  bare id take it from the returned locator (`locator.workflowId`) or a
  referenced run's result (`result.workflowId`). Workflow existence stays
  with the callers, which own its timing: eager for `dependsOn` (whole list,
  before any prerequisite runs) and for `#runReferencedWorkflow` (with the
  calling `stepId`), lazy via `#resolveWorkflow` for a sub-workflow step. A
  canonical *string* form was considered and rejected: the entry document's
  own workflows have no expression spelling, and source names are
  document-scoped, so the expression form is not context-free.
- **The document moved into the invocation**: `WorkflowInvocation.document`,
  `#run(locator, …)`, `#resolveWorkflow(locator, scope)`, and `#evaluate`
  taking the document per call. Every former `this.#document` read in the run
  path follows the invocation's document; parent-side evaluation of a
  sub-workflow step (its `parameters`, `outputs`, `successCriteria`, action
  selection) stays on the *parent's* document — only the sub-run switches.
- **`StepExecutor` stays document-bound** (the seam from `#34` untouched — no
  per-call document argument, no factory option; decided over both
  alternatives the predecessor note weighed). It gained
  `forDocument(document)`, deriving a sibling bound to a foreign document and
  sharing the registry + operation executor — `this` for the already-bound
  document, and cheap enough to derive on demand (eight stateless field
  assignments) that no per-run cache is kept.
- **Identity is the (documentURI, workflowId) pair** for cycle detection
  (`WorkflowCallStack.enter(workflowId, via, documentUri)` — required, so a
  foreign source pointing back at the entry document closes a detectable
  cycle and a stack can never mix qualified and unqualified frames), and
  `{documentURI}#{workflowId}` keys the normalized-workflow cache and
  `dependencyRuns` dedup — as §4c anticipated. The stack knows the run's
  entry document URI from construction and derives `path` display itself:
  the bare id for entry-document frames (test/back-compat), `uri#id` for
  foreign ones.
- **`$workflows.<id>` state stays keyed by the bare id** — the only form the
  runtime-expression grammar can express; same-id-across-documents is
  last-write-wins, documented in the README as a known hazard (same class as
  two same-document calls of one workflow).
- **`dependencyInputs` is keyed by the `dependsOn` entry as written** (bare id
  locally, whole expression cross-document) — zero mechanism, the natural
  behavior once the raw entry string is the lookup key.
- **Foreign documents come straight from `registry.acquire`** — no run-side
  document ledger. A prototype carried one (a per-run URI → document map the
  normalizer consulted before the registry) to guard against the size-4 LRU
  evicting a document mid-run, but it bought no correctness: cycle detection
  and every cache key are URI-based, `forDocument`'s identity check only
  matters for the (already-pinned) entry document, and the evaluator's sync
  `registry.get` never consulted it anyway. `acquire` refreshing LRU recency
  makes mid-run eviction unlikely; proper pinning is issue `#74`'s
  registry-level fix.

Tests: 20 in a new `WorkflowExecutorCrossDocument` suite over a two-document
fixture pair whose APIs have distinct server prefixes (so a request URL proves
which document's sources resolved an operation), covering all four positions,
foreign-document expression bases, a foreign workflow's own local references,
same-id-no-false-cycle, a cross-document cycle with mixed-display `path`,
depth across documents, and every new error reason; 2 new `WorkflowCallStack`
document-qualified unit tests (the whole suite now enters frames with a
document URI, as the API requires); the four old rejection tests repurposed to
`source-description-not-arazzo` (their fixtures reference a workflow of an
*openapi* source), keeping the validate-before-run and abort-ordering
assertions.

### Not yet implemented / missing

- **e2e suite** (§10) — only the deterministic stub unit suite exists; a real
  multi-step petstore run end-to-end is a separate opt-in follow-up.

### Next — what to build, and what each decision costs

Reference-retry shipped 2026-08-17 — see §0 "Shipped (reference-retry)" above
for what was built, including how each decision that section originally
marked PROPOSED was resolved (all five shipped as proposed). Goto-workflow
transfer shipped the same day, and cross-document workflow references (the
last item this list carried) on 2026-08-21 — see their §0 sections above.
Nothing sequenced remains; what is left is unordered:

the opt-in e2e petstore suite (§10), issue `#39`
(parameter inheritance as an apidom refractor plugin — cross-repo), issue `#35`
(per-source-description `server` / `serverVariables`), issue `#36` (request
provenance for `RequestInterceptor`), issue `#62` (an input channel for
retry-reference and transfer targets), and an `executeAll()` for
libopenapi-style batch semantics (§5's interpretation note).

**Loose ends worth not losing:**

- A pre-1.0 **API surface review**: PR `#3` established "internal" as a category
  by unexporting three collaborators, but applied it only to those three. The
  same question — published building block, or internal decomposition? — is
  unasked for most of the barrel.
- `StepAttemptOutcome` lives in `StepRetryRunner` while being produced by
  `StepExecutor` and consumed by the executor's loop; its home is arbitrary and
  is the one type placement worth revisiting.
- The duplicated `#evaluate` runtime-expression bridge in `StepExecutor` and
  `WorkflowExecutor` (the workflow-side one now takes the document per call),
  with nothing keeping the two in step — a base-class or shared-collaborator
  candidate.
- **Mid-run LRU eviction** (issue `#74`): the registry pins only the entry
  document, so a run touching more than `MAX_DOCUMENT_REGISTRY_SIZE` (4)
  documents can have one evicted mid-run — a re-`acquire` re-fetches and
  re-parses (correct, URIs key everything, but wasted work), and
  `RuntimeExpressionEvaluator`'s *synchronous* `registry.get` for
  `$sourceDescriptions.*` silently misses. Pre-existing for OpenAPI sources;
  the fix is a pin/release (refcount) registry API.
- **`$workflows` id collisions across documents** (see the shipped section
  above): last-write-wins is documented, but a spec-level answer — or a
  strict-mode diagnostic when a run records two different workflows under one
  bare id — is worth revisiting.

## 1. Purpose & boundary

`WorkflowExecutor` is the loop that turns "run one step" into "run a workflow".
It is the **stateful orchestrator** that owns everything `StepExecutor`
deliberately refused:

- iterates a workflow's steps, calling `StepExecutor.execute(step, state, opts)`
  per step;
- **mutates** `WorkflowExecutionState` — records each step's resolved `outputs`
  (so later steps read `$steps.x.outputs.y`), sets workflow `outputs`;
- **interprets the returned `SelectedAction`** — the control flow StepExecutor
  only _selects_ but does not act on: `goto`, `retry`, `end`, and the two path
  defaults;
- handles **`workflowId` steps** (sub-workflow calls) — the recursion
  `StepExecutor` throws on;
- applies **workflow-level defaults** (`successActions`/`failureActions`,
  `parameters`) that steps inherit;
- resolves workflow `inputs` and applies workflow `outputs`.

Dependency direction is one-way **today**: `WorkflowExecutor → StepExecutor`.
Sub-workflows are the WorkflowExecutor's _own_ recursion (it calls itself), so
there is no cycle. This holds because StepExecutor deliberately refuses
`workflowId` steps — it **throws `reason:'workflow-step'`** rather than run a
workflow — and WorkflowExecutor intercepts those steps before they reach it
(§4b).

That refusal is a boundary of convenience, not a permanent law. A step whose
target is `workflowId` _is_ a workflow invocation, so a future StepExecutor may
want to execute it directly instead of throwing. When that happens, StepExecutor
must **not** import `WorkflowExecutor` concretely (that would create a module
cycle) — it should depend on an injected port, e.g.:

```ts
interface SubWorkflowRunner {
  execute(
    workflowId: string,
    inputs?: Record<string, unknown>,
    executeOptions?: Record<string, unknown>,
  ): Promise<WorkflowExecutionResult>;
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
  readonly document: ArazzoDocument; // entry doc (source of workflows + $components/$sourceDescriptions)
  readonly registry: DocumentRegistry; // loaded source docs
  readonly stepExecutor: StepExecutor; // injected per-step engine (as shipped; was clientFactory pre-HTTPClient-seam)
  // tunables with sane defaults:
  readonly maxSteps?: number; // runaway-goto/retry guard, global across the whole recursion tree (default 1000)
  readonly maxWorkflowDepth?: number; // sub-workflow recursion guard (default 32, matching libopenapi)
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; // injectable for retryAfter; default real timer (abort-aware, PR #4), tests pass a no-op
  readonly now?: () => number; // injectable clock for durationMs (PR #3); default Date.now
}

export interface WorkflowExecutionResult {
  readonly workflowId: string;
  readonly outputs: Record<string, unknown>; // workflow $outputs, resolved — always {} when status is 'transferred'
  readonly steps: readonly StepRunRecord[]; // trace: what ran, in order, with outcomes
  readonly status: 'completed' | 'ended' | 'failed' | 'transferred'; // ended = an `end` action fired; failed = a step broke-and-returned; transferred = a goto-workflow one-way transfer (goto-workflow transfer, issue #65)
  readonly settledStatus: 'completed' | 'ended' | 'failed'; // where a transfer chain actually landed — status itself when not 'transferred'; computed eagerly, always present (goto-workflow transfer, issue #65)
  readonly dependencies?: readonly WorkflowExecutionResult[]; // dependsOn runs, in order (PR #3)
  readonly durationMs?: number; // wall-clock for the run, retries/waits included (PR #3) — for a transferred run, covers the whole target chain too
  readonly transferredTo?: WorkflowExecutionResult; // the target's own result, present only when status is 'transferred' (goto-workflow transfer, issue #65)
}

export interface StepRunRecord {
  readonly stepId: string;
  readonly successful: boolean;
  readonly action: SelectedAction | undefined;
  readonly attempts: number; // >1 when retried
  // nested sub-workflow runs this step's attempts produced, in attempt order —
  // an array because a retried workflowId step runs the sub-workflow once per
  // attempt, and each run is a distinct trace; the last entry is the run the
  // record's `successful`/`action` describe. (PR #3)
  readonly subWorkflows?: readonly WorkflowExecutionResult[];
  readonly durationMs?: number; // all attempts including retryAfter waits (PR #3)
}

class WorkflowExecutor {
  constructor(options: WorkflowExecutorOptions);
  // options-bag signature from PR #3 on (was positional inputs/executeOptions):
  // dependencyInputs feeds implicitly-run dependsOn workflows by workflowId.
  execute(
    workflowId: string,
    options?: {
      inputs?: Record<string, unknown>;
      executeOptions?: Record<string, unknown>;
      dependencyInputs?: Record<string, Record<string, unknown>>;
      runDependencies?: boolean; // default true; false = caller asserts deps are satisfied out-of-band
      signal?: AbortSignal; // cancels the run; throws reason: 'aborted' at the next boundary (PR #4)
    },
  ): Promise<WorkflowExecutionResult>;
}
```

Design choices (matching StepExecutor's established conventions):

- **`execute(workflowId, options)`** — caller names the workflow;
  WorkflowExecutor extracts + normalizes it (SRP: extraction/normalization is a
  detail of running a _named_ workflow, unlike StepExecutor where the caller
  passed the already-extracted step — here the caller only has an id).
  - _Open question for review:_ symmetry with StepExecutor (which takes a
    `step` element) would argue `execute(workflow, inputs)`. But a workflow is
    named by id and the executor must resolve `dependsOn`/sub-workflows by id
    anyway, so id-in is more natural. Leaning id-in.
- **Returns data, and also owns the state** internally — unlike StepExecutor
  (which mutates nothing), WorkflowExecutor _is_ the mutation owner. It creates
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
  # stepExecutor is the injected collaborator (WorkflowExecutorOptions.stepExecutor)
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
      'goto':      index = indexOf(transition.stepId)      # must be in current workflow
      'transfer':  transferredTo = await #run(transition.workflowId, {}, ...); status = 'transferred'; break  # one-way — this run ends here, not `index += 1`
      'end':       status = 'ended'; break
      'break':     status = 'failed'; break                # failure default (break and return)
  if status == 'transferred': outputs = {}                 # own outputs declaration never evaluated
  else: applyWorkflowOutputs(workflow, state)               # resolve workflow.outputs against final state
  return { workflowId, outputs, steps: trace, status, transferredTo? }
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
  exclusive w/ workflowId) → `{kind:'goto', stepId}`.
- **`type: goto`** with `workflowId` → a one-way transfer of control to another
  workflow → `{kind:'transfer', workflowId}` (run it; this run ends there — see
  note. Not "run it, then continue": that was the pre-decision guess, corrected
  below).

### Failure (§Failure Action Object): types `end`, `retry`, `goto`

- **no matching onFailure action** → default: `"break and return"` →
  `{kind:'break'}` (status: failed).
- **`type: end`** → `{kind:'end'}`.
- **`type: retry`** → `"the current step will be retried"`. Retry is handled in
  `runStepWithRetry` (see §6), NOT here — by the time `interpret` sees a
  non-retry action, retries are exhausted or not requested. Semantics:
  `retryLimit` (default 1 if unset) attempts, `retryAfter` seconds delay
  between; a `retry` action MAY carry `stepId`/`workflowId` to execute _before_
  retrying (`"the reference is executed and the context is returned, after which
the current step is retried"`). `"retryLimit MUST be exhausted prior to
executing subsequent failure actions"` — so after exhaustion, we re-evaluate
  the _remaining_ failure actions (the ones after the retry) for the final
  transition. **This is the subtlest bit — see §6.**
- **`type: goto`** (stepId/workflowId, mutually exclusive) → same as success
  goto.

`interpret` reads the `SelectedAction` element via the ns accessors already used
by `ActionResolver`: `toValue(action.type)`, `action.stepId`, `action.workflowId`,
`action.retryAfter`, `action.retryLimit`. Guard element presence with
`isStringElement` / `isNumberElement`.

**goto-workflow transfer — SHIPPED**, see §0 "Shipped (goto-workflow
transfer)" for the as-built semantics, result shape, and rationale (traced to
[OAI/Arazzo-Specification#66](https://github.com/OAI/Arazzo-Specification/issues/66)
and [issue #65](https://github.com/usearazzo/arazzo-toolkit/issues/65)). Kept
here only as a pointer, since this section predates the decision and its
pseudocode above has been updated to match. Sub-workflow _calls_ (step with
`workflowId` field, §4b below) remain the separate, well-defined recursion
path that _does_ return — a `goto`'s transfer does not.

## 4b. Sub-workflow steps (step.workflowId)

A step whose target is `workflowId` (not operationId/operationPath) is a
sub-workflow invocation — the case StepExecutor throws on
(`reason:'workflow-step'`). WorkflowExecutor intercepts these _before_ calling
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
  _(The follow-up shipped: `ArazzoWorkflowLocatorNormalizer`, see §0 "Shipped
  (cross-document workflow references)".)_
- **Depth guard** (`maxWorkflowDepth`) bounds _legitimate_ nesting depth.

## 4c. Recursion / cycle detection (call chain)

The depth guard alone is not enough. A workflow can reference itself through a
chain of sub-workflow steps — directly (A has a step that calls A) or indirectly
(A → B → A). This is a **cycle**: it never terminates. Bouncing off
`maxWorkflowDepth` after N frames would _mask_ it as "too deep" and report the
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

- **Cycle vs. depth**: `workflow-cycle` = the _same_ workflow is already on the
  active call stack (guaranteed non-terminating); `workflow-depth` = distinct
  workflows nested past the budget (legitimate, just bounded). Distinct reasons,
  distinct diagnostics. The error carries the offending `path` (the chain
  A → B → A) so the author can see the loop.
- **Push/pop discipline matters**: a _set_ alone would flag a diamond
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
concurrent `execute(...)` calls on the _same_ executor instance would share and
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
- ~~_Open question:_ are dependsOn outputs shared into the dependent workflow's
  state?~~ **RESOLVED** — run them for their side effects / ordering, do NOT
  merge their outputs into the dependent's own; `state.setWorkflow(id, {outputs})`
  so `$workflows.<id>.outputs` resolves. Inputs, memoization, `runDependencies`,
  and the on-demand-vs-batch interpretation are all decided in the "Next: PR #3"
  section of §0 — that section is authoritative for §5's semantics.

## 6. Retry handling (`runStepWithRetry`) — the subtle part

**Status: SHIPPED (PR #2)** — the draft below is the original design sketch;
the implemented resolution (walk `matchedActions`, per-retry budgets keyed by
element identity, exhaustion fall-through) is recorded in §0 and open question
#5. Kept for the spec quotes and rationale. The `if action has stepId/workflowId:
execute that reference first` line in the sketch below was left unimplemented
by PR #2 and shipped later, separately — see §0 "Shipped (reference-retry)".

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
After exhaustion, per spec we should evaluate the failure actions _after_ the
retry action — this needs care: `ActionResolver` returns the _first_ matching
action. To honor "retryLimit exhausted prior to subsequent failure actions", on
exhaustion we re-run action selection _excluding_ the exhausted retry action, or
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
  The spec says a step _overrides_ the workflow default, not that the two lists
  union; whole-list override is the simpler, defensible reading and what we
  shipped. If a future spec clarification demands union semantics, revisit — but
  do not reintroduce name-merge speculatively.

How it's wired — **superseded by `#49`** (the original `defaultActions` wiring
below is kept for the record):

- **As of `#49`:** `ArazzoWorkflowNormalizer` copies the workflow's action lists
  into each step that does not declare the corresponding key (`hasKey`, so an
  explicit `onSuccess: []` suppresses the default rather than falling back).
  Neither executor knows the rule exists — `selectActions` just reads the step's
  own list. `StepDefaultActions` and the fourth `StepExecutor.execute` /
  `selectActions` parameter were removed. Elements are shared into steps, not
  cloned, so retry budgets keyed by element identity are unaffected.
- _Original wiring (PR `#290`, removed by `#49`):_ `StepExecutor.execute` had an
  optional 4th arg `defaultActions` selected via
  `step.onSuccess ?? defaultActions.onSuccess`; `ActionResolver` was widened to
  the workflow-level list element types; `WorkflowExecutor` resolved the
  workflow lists once per run and passed them to every step.

### parameters — DONE (`#40`, a genuine per-parameter merge)

Unlike actions, this is additive/override at the individual-parameter level:
**effective parameters** = merge(workflow.parameters, step.parameters) by
parameter identity (`(name, in)`, an absent `in` equal only to another absent
`in`), step overriding, step's own parameters leading the merged list.

Neither of the two options this plan weighed (synthesized merged step element
vs. an `additionalParameters` arg) shipped — `#40` put the rule in
`ArazzoWorkflowNormalizer`, alongside dereferencing, mirroring how the OpenAPI
normalizers inherit a Path Item's parameters into an Operation. A normalized
step already carries what it inherits, so the executors never see the rule —
the same shape `#49` later gave actions. Issue `#39` tracks promoting it into
an apidom `normalize-parameters` refractor plugin so both sides read
identically.

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
`dependsOn-cycle`, `goto-target-not-found`, `step-budget`, `workflow-depth`,
`cross-document-workflow-unsupported` (initial; since retired — cross-document
references resolve now, and a bad one throws `invalid-workflow-reference`,
`source-description-not-found`, or `source-description-not-arazzo` instead,
per §0 "Shipped (cross-document workflow references)"), `aborted` (PR #4 — the caller
cancelled the run; carries `workflowId`/`stepId`/`path` and the signal's own
`reason` as `cause`), `retry-target-not-found` (reference-retry — a `retry`
action's `stepId` reference names no step in the current workflow; carries the
missing target as `stepId`, matching `goto-target-not-found`'s convention).
`goto-workflow-unsupported` (initial) is retired — a `goto` naming a
`workflowId` is a supported transfer now (goto-workflow transfer, §0). Its
sibling `ambiguous-target` (already used for a sub-workflow step naming a
workflow alongside an operation, and for a `retry` naming both `stepId` and
`workflowId`) now also covers a `goto` naming both. Goto-workflow transfer also
adds `unknown-transition-kind` — the `#run` loop's `switch (transition.kind)`
`default` branch, provably unreachable while `StepTransitionInterpreter`
produces only known kinds (TypeScript narrows to `never` there); not a
reachable authoring error, so not in the README's user-facing reason table —
a defensive guard against a future `Transition` kind landing without a
matching `case`, kept loud (`ExecutionError`, not a bare `Error`) rather than
silent so it would fail a build's tests immediately if it ever fired.

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
   later once semantics confirmed. _(Both have since shipped as their own
   follow-ups rather than folded into this PR — see §0 "Shipped (goto-workflow
   transfer)" and §0 "Shipped (cross-document workflow references)"; nothing
   from this slicing still throws.)_

## Open questions for review (decide before coding)

1. ~~`execute(workflowId, ...)` (id-in) vs `execute(workflow, ...)`
   (element-in)?~~ **RESOLVED: id-in.** Implemented.
2. ~~Param merge via StepExecutor `additionalParameters` arg (preferred) vs
   synthesizing a merged step element?~~ **RESOLVED (`#40`): neither** — the
   merge happens in `ArazzoWorkflowNormalizer` at normalization time (§7), and
   `#49` later moved actions inheritance to the same home, retiring the
   `defaultActions` arg this question assumed as precedent.
3. ~~Step-level `goto` with `workflowId`: throw-initially (recommended) vs
   run-and-continue?~~ **RESOLVED (goto-workflow transfer, issue #65):**
   neither guess — a one-way transfer with no return, ending the calling
   run's own steps at the `goto` and reporting the target's result nested
   under a new `status: 'transferred'`. See §0 "Shipped (goto-workflow
   transfer)".
4. ~~dependsOn output sharing semantics — run-for-ordering only + expose via
   `$workflows`?~~ **RESOLVED (PR #3 scope):** run for ordering/side effects,
   expose via `$workflows.<id>.outputs` (`state.setWorkflow`), no merging into
   the dependent's own outputs; dependencies take inputs from the caller's
   `dependencyInputs` map (`{}` when absent) and are memoized per run (see
   "Next: PR #3" above).
5. ~~Retry-exhaustion "subsequent failure actions" ordering — confirm the
   re-selection approach in §6.~~ **RESOLVED (PR #2):** `StepExecutor` returns
   _all_ matching failure actions (`matchedActions`); the retry loop walks that
   list — retry-while-under-limit (each retry with its own budget), else advance
   to the next matching action, else break-default. No re-evaluating criteria in
   the loop; each attempt re-runs the operation and re-selects against the fresh
   response.

Note on runtime expressions vs. criteria (bit us while fixing fixtures): a value
in `outputs` / `parameters` / `requestBody` must be a _whole_ runtime expression,
where member access is a JSON Pointer fragment (`$response.body#/id`) and array
length / indexing like `.length` / `[0]` is NOT expressible (needs JSONPath,
which Arazzo only allows in a criterion `context`, not in a value). A
`successCriteria` `condition` uses the _separate_ simple-criterion grammar, which
DOES support JS-style `.length` / `[0]` / `.field` navigation — it resolves only
the embedded `$response.body` prefix and does the rest itself. Same-looking text,
two engines; don't "correct" dotted access inside a condition.

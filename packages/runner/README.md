# @usearazzo/runner

> [!WARNING]
> This package is under heavy development and is not yet published to npm. It is
> developed within the [`arazzo-toolkit`](https://github.com/usearazzo/arazzo-toolkit) monorepo and
> will be publicly installable once its API stabilizes; until then, APIs may change without notice.

`@usearazzo/runner` executes [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html)
workflows against live APIs described by
[OpenAPI Specification](https://spec.openapis.org/oas/latest.html) source descriptions. It builds on
[SpecLynx ApiDOM](https://github.com/speclynx/apidom) data models and reuses the loading,
resolution, and normalization primitives shared across
[`@usearazzo/parser`](https://www.npmjs.com/package/@usearazzo/parser) and
[`@usearazzo/resolver`](https://www.npmjs.com/package/@usearazzo/resolver).

**Supported Arazzo versions:**

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

**Supported OpenAPI versions (for source descriptions):**

- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Architecture

Running an Arazzo workflow is a pipeline of small, single-responsibility building blocks organized
into four main components:

- **`DocumentRegistry`**: loads and caches the Arazzo entry document and its OpenAPI source
  descriptions, so each is fetched and parsed once.
- **`WorkflowExecutor`**: iterates a workflow's steps, owns the run state, and interprets
  control-flow actions (`goto`, `retry`, `end`).
- **`StepExecutor`**: runs a single operation-shaped Arazzo step (`operationId` /
  `operationPath`): locates its operation, resolves inputs, evaluates criteria and outputs, and
  selects the next action. A `workflowId` step is run by `WorkflowExecutor` instead, which borrows
  this component's criteria evaluation and action selection for it.
- **`OpenAPIOperationExecutor`**: runs a single OpenAPI operation: builds the HTTP request
  (parameter serialization, securities, server resolution), sends it through the pluggable
  `HTTPClient` transport, and normalizes the raw response into the runner's response model.

```mermaid
flowchart TD
    Registry[("DocumentRegistry<br/><i>load & cache documents</i>")]

    WF["WorkflowExecutor<br/>iterate steps · own state · control flow"]
    Step["StepExecutor<br/>run one Arazzo step"]
    Op["OpenAPIOperationExecutor<br/>build request · normalize response"]
    HTTP["HTTPClient<br/>send the built request (fetch by default)"]

    WF -->|"execute step"| Step
    Step -->|"execute OpenAPI operation"| Op
    Op -->|"send HTTP request"| HTTP

    Registry -.->|documents| WF
    Registry -.->|documents| Step
    Registry -.->|documents| Op

    %% brand colors: Arazzo green, OpenAPI green, neutral registry grey
    classDef arazzo fill:#94C83D,stroke:#6BA543,stroke-width:1px,color:#231F20;
    classDef openapi fill:#6BA543,stroke:#4D5A31,color:#fff;
    classDef neutral fill:#424143,stroke:#231F20,color:#fff;

    class WF,Step arazzo;
    class Op,HTTP openapi;
    class Registry neutral;
```

Each layer reads run state but never mutates it. The `WorkflowExecutor` is the single writer that
records outputs and interprets the returned control-flow action.

## `DocumentRegistry`

Loads and caches Arazzo and OpenAPI documents, so a source description referenced by many steps is
fetched and parsed once.

```js
import { DocumentRegistry } from '@usearazzo/runner';

const registry = new DocumentRegistry();

// the entry Arazzo document.
const arazzoDoc = await registry.acquireEntryDocument(
  'https://ui.usearazzo.com/petstore-order-workflow.arazzo.yaml',
);

// a source description, resolved by name to an absolute URI, then acquired.
const uri = arazzoDoc.resolveSourceDescriptionURI('petstoreAPI');
const openapiDoc = await registry.acquire(uri);

registry.clear(); // drop cached documents to reclaim memory
```

## `WorkflowExecutor`

`WorkflowExecutor` is the stateful orchestrator that runs a whole workflow. It iterates a workflow's
steps in list order, calling `StepExecutor` per step, and owns the run state (a
`WorkflowExecutionState`) that accumulates each step's outputs so later steps can read
`$steps.*.outputs`. It interprets the control-flow actions `StepExecutor` only _selects_ (advancing
to the next step, jumping via `goto`, transferring one-way to another workflow via a `goto` naming a
`workflowId`, or stopping on `end` or the failure break-default), and resolves the workflow's
`outputs` against the final state — unless the run transferred, in which case it never reaches its
own end and `outputs` is always `{}`.

Give it the entry document, registry, and a `StepExecutor` once; call `execute` per run with a
`workflowId` and its `inputs`:

```js
import {
  DocumentRegistry,
  OpenAPIOperationExecutor,
  StepExecutor,
  WorkflowExecutor,
} from '@usearazzo/runner';

const registry = new DocumentRegistry();
const arazzoDoc = await registry.acquireEntryDocument(
  'https://ui.usearazzo.com/petstore-order-workflow.arazzo.yaml',
);

// compose the engines bottom-up: operation executor → step executor → workflow
// executor. Each takes its collaborator rather than building one, so a stub
// drops in for tests at any layer. The operation executor sends requests
// through global fetch by default; pass { httpClient } to swap the transport.
const operationExecutor = new OpenAPIOperationExecutor();
const stepExecutor = new StepExecutor({ document: arazzoDoc, registry, operationExecutor });
const executor = new WorkflowExecutor({ document: arazzoDoc, registry, stepExecutor });

const result = await executor.execute('authenticateAndOrderPet', {
  inputs: {
    username: 'user1',
    password: 'secret',
    preferredPetStatus: 'available',
  },
});

console.log(result.status); // 'completed' | 'ended' | 'failed' | 'transferred'
console.log(result.settledStatus); // 'completed' | 'ended' | 'failed' — the actual verdict; see Control flow
console.log(result.outputs); // workflow $outputs, resolved against final state
console.log(result.steps); // trace: each step's id, success, action, attempts, durationMs
console.log(result.durationMs); // elapsed time for the whole run
```

`execute` takes the workflowId and an options bag:

| option             | meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| `inputs`           | the workflow's inputs, read via `$inputs`                                            |
| `executeOptions`   | opaque bag forwarded to every step's operation (e.g. `server`, `requestInterceptor`) |
| `dependencyInputs` | inputs for workflows run to satisfy `dependsOn`, keyed by the entry as written       |
| `runDependencies`  | run this workflow's `dependsOn` workflows first (default `true`)                     |
| `signal`           | an `AbortSignal` cancelling the run (see [Cancellation](#cancellation))              |

The run state is created fresh per `execute` call and owned internally; the returned `result` is
read-only. Every layer takes its collaborator rather than building one: `WorkflowExecutor` takes a
`StepExecutor`, which takes an `OpenAPIOperationExecutor`, which takes the `httpClient` transport.
Each therefore stays agnostic to how the layer beneath it reaches the live API, and a deterministic
stub drops in for tests at any level.

### Control flow

After each step, the selected `onSuccess` / `onFailure` action determines what happens next:

- **no matching action**: success falls through to the next step; failure _breaks and returns_
  (`status: 'failed'`);
- **`end`**: stops the run early with `status: 'ended'`, returning the outputs accumulated so far;
- **`goto` a `stepId`**: jumps to that step within the current workflow;
- **`goto` a `workflowId`**: transfers control to another workflow — see below;
- **`retry`**: re-runs the step's operation up to the action's `retryLimit` (default `1`), waiting
  `retryAfter` seconds between attempts. Per spec, `retryLimit` is exhausted _before_ subsequent
  failure actions run, so an exhausted `retry` falls through to the next matching failure action,
  which may be another `retry` with its own independent budget or a terminal `end` or `goto`. If
  none remains, the break-default applies. Each step's `attempts` count is surfaced in the result
  trace.

A `retry` action may also carry a `stepId` or `workflowId` **reference** — a repair to run before
the next attempt (re-authenticate, reset a fixture). It fires once per attempt the action grants,
not once for the whole retry chain: after the `retryAfter` wait, before the step is re-run. A
`stepId` reference re-runs that step of the current workflow, charged against the same step budget
as any attempt; a `workflowId` reference runs that workflow to completion, with no inputs — the
specification gives a retry reference no input-mapping mechanism of its own, the same gap
`dependsOn` has — recording its outputs under `$workflows.<id>` the way a sub-workflow step does.
Neither kind's own success/failure actions are followed, and a failed reference does not break the
retry chain: the specification speaks of the reference's _completion_, not its success, and a
futile retry is still bounded by `retryLimit`. Reference runs are surfaced on the step's trace as
`retryReferences`, one entry per firing.

A `goto` naming a `workflowId` **transfers control one-way** to that workflow: unlike `end`, control
does not return. The specification calls `goto` "a one-way transfer of workflow control", and the
`stepId`/`workflowId` field descriptions condition "context transfers back upon completion" on
`retry` specifically — the scoping is the signal that a `goto`'s transfer does not return. The
calling workflow's own run ends at the `goto`, so its `outputs` declaration is never evaluated
(`result.outputs` is always `{}` on a transferred result) and `result.steps` keeps only the partial
trace up to the transfer. The target's own result is nested at `result.transferredTo`, with
`result.status` set to `'transferred'`; if the target itself transfers onward, the chain reads back
via `transferredTo.transferredTo`, recursively. Like a retry's `workflowId` reference, a transfer's
target runs with no inputs — a `goto` action carries no `parameters`, and the specification gives it
no input-mapping mechanism (the same gap issue `#62` tracks for retry references). A transfer joins
the same guarded call tree as everything else below — a self-transfer or a transfer cycle throws
`workflow-cycle`, and a legitimate transfer chain is bounded by `maxWorkflowDepth` — but, unlike a
retry's reference, entering the target is **not** charged against the step budget: a `goto` fires
once per step evaluation, with no way to re-fire from the same frame the way `retryLimit` lets a
reference do.

> [!NOTE]
> A transfer target is entered on the *transferring* workflow's own call-stack frame, which is why
> the cycle/depth rules above apply to it at all. This means a transfer chain does not behave like a
> `goto stepId` loop: since the transferring workflow's frame stays on the stack (there is no return
> to pop it), a workflow that transfers back to a workflow already on that chain — even indirectly,
> even once the loop's actual exit condition would have been met — throws `workflow-cycle` rather
> than looping, and a long acyclic chain of distinct workflows throws `workflow-depth` past
> `maxWorkflowDepth` (default `32`) rather than running indefinitely. A `goto stepId` loop bounded by
> ordinary data (poll until a status flips, say) has no such ceiling — only the shared step budget. A
> state machine expressed as workflows chained by `goto workflowId` should therefore be modeled as a
> bounded sequence, not a cycle that revisits a workflow already in progress.

Because a transferred result is not itself a verdict about success — only a record of where control
went — every `WorkflowExecutionResult` carries a second field, `settledStatus`, alongside `status`:
`'completed' | 'ended' | 'failed'`, computed eagerly (when the result is built, not when read) by
following a `'transferred'` result's `transferredTo` chain to its terminal, non-`transferred` result;
for a result that isn't `'transferred'`, it simply repeats `status`. Anywhere this library reads a
nested run's outcome — a `dependsOn` prerequisite, a sub-workflow step's own success, a retry
reference's recorded `successful` — it compares `settledStatus`, not `status`: a dependency,
sub-workflow step, or reference whose transfer chain settles `'completed'` or `'ended'` is treated as
satisfied; one that settles `'failed'` is treated as failed. See
[Composing workflows](#composing-workflows) for how this interacts with `$workflows.<id>.outputs`.

> [!IMPORTANT]
> `settledStatus` matters on the **top-level** result `execute()` returns, too, not only on nested
> ones. A root run that transfers reports `result.status === 'transferred'`, not `'failed'`, even when
> its target's own chain fails — `result.settledStatus === 'failed'` is the check that reflects where
> the run actually landed:
>
> ```js
> const result = await executor.execute('myWorkflow');
> if (result.settledStatus === 'failed') {
>   // handles both an ordinary failed run and one that transferred into a failing chain
> }
> ```
>
> A bare `result.status === 'failed'` check silently misses the latter case. `settledStatus` is
> always present — comparing it is exactly as cheap as comparing `status`, no extra call required.
>
> For the terminal *result itself* — its `outputs`, `steps`, `workflowId` — rather than just its
> status, the exported `settledResult(result)` helper follows the same chain and returns the object it
> ends on (itself, unchanged, when `result.status` isn't `'transferred'`):
>
> ```js
> import { settledResult } from '@usearazzo/runner';
>
> const landedOn = settledResult(result);
> console.log(landedOn.workflowId, landedOn.outputs);
> ```

A runaway `goto` loop, a runaway `retry`, **or** a runaway tree of sub-workflow calls is bounded by
`maxSteps` (default `1000`), which counts every step attempt and throws `ExecutionError`
(`reason: 'step-budget'`) when exceeded. The budget is shared by the whole call tree rather than
granted afresh per workflow, so a sub-workflow cannot escape the ceiling the caller set; the error
carries the offending `path` (the chain of workflowIds in progress). The `retryAfter` delay uses an
injectable `sleep` (`WorkflowExecutorOptions.sleep`, default a real timer) so tests can run without
waiting, and `durationMs` uses an injectable `now` (default the monotonic `performance.now`) so
they can assert timings.

### Composing workflows

A step targeting a `workflowId` calls another workflow. Its `parameters` become that workflow's
inputs (mapped by `name`, and including any the calling workflow passed down), the sub-run is
recorded under
`$workflows.<id>`, and the step's own `outputs` and `successCriteria` are then resolved against that
updated state. A sub-run that ends `failed` puts the step on its failure path, so `onFailure` —
including `retry`, which re-runs the whole sub-workflow — applies exactly as for an operation step.

A workflow's `dependsOn` workflows are run to completion before its own steps. Each one's outputs
become readable as `$workflows.<id>.outputs`; they are not merged into the dependent's own outputs.
A dependency already completed in the same run is not run again, so a diamond does not duplicate its
side effects. Because the specification gives `dependsOn` no input-mapping mechanism, a dependency
that needs inputs takes them from the caller's `dependencyInputs` map; pass `runDependencies: false`
to assert they were already satisfied out-of-band. That assertion covers the workflow you name and
no more — a sub-workflow it calls still runs its own prerequisites, which the caller may not know
exist. A dependency that fails makes the run `failed` without executing any of its own steps.

Both recurse through one guarded call tree. Re-entering a workflow already in progress throws
(`reason: 'workflow-cycle'`, or `'dependsOn-cycle'` when every edge closing the loop is a dependency
edge), carrying the offending `path`; nesting past `maxWorkflowDepth` (default `32`, counting the
workflow `execute` was called with) throws `reason: 'workflow-depth'`. A diamond is not a cycle: a
workflow that completed and unwound may be entered again.

The result mirrors this structure. A step record carries `subWorkflows` — one nested
`WorkflowExecutionResult` per attempt, so a retried sub-workflow step keeps every attempt's trace —
and a result carries `dependencies`, the prerequisite runs in declaration order. A result whose
`status` is `'transferred'` (see [Control flow](#control-flow)) additionally carries `transferredTo`,
nesting the transfer target's own result — a workflow that ran `dependsOn` prerequisites before
transferring still reports them under `dependencies`; the two fields are independent, not exclusive.

A nested run reached this way — a sub-workflow step's target, a `dependsOn` prerequisite, a retry
reference — is judged by its `settledStatus`, not by a raw `'transferred'` status: a sub-workflow
step that targets a workflow which transfers onward to a completed run still takes
the success path, and a `dependsOn` prerequisite that transfers onward to a failed run still fails
the dependent. Either way, the nested run's own recorded identity and `$workflows.<id>.outputs`
reflect the workflow that was actually *called*, not the one control ended up in — a transferred
call always records `outputs: {}` there, for the same reason its own top-level `outputs` is `{}`
(see [Control flow](#control-flow)). The terminal outputs of a transfer chain are reachable, just
not under that key: follow `transferredTo.outputs` (or `transferredTo.transferredTo.outputs`, for a
chain) on the nested result itself, found on the calling step's `subWorkflows` entry or the result's
`dependencies` entry.

### Cross-document workflow references

Anywhere a workflow is referenced — a sub-workflow step's `workflowId`, a `dependsOn` entry, a
`retry` action's `workflowId` reference, a `goto`'s transfer target — the reference may name a
workflow of **another Arazzo document**, written as the runtime expression
`$sourceDescriptions.<name>.<workflowId>`. The named source description must resolve to an Arazzo
document; its declared `type` is not trusted — the source is classified by what it actually parses
to, the same way operation sources are. Only that dotted spec form is a workflow reference: the
resolver package's `$sourceDescriptions.<name>#/json/pointer` form is a `$ref`-time construct, not
a runtime expression, and is rejected (`reason: 'invalid-workflow-reference'`).

A foreign workflow runs **against its own document**: its plain `operationId`s resolve against
*that* document's source descriptions, its `$components` / `$sourceDescriptions` expressions
against that document, and its own plain workflow references (a nested `workflowId` step, its own
`dependsOn`) within that document. Source description *names* are likewise scoped to the document
they are written in — two documents may both name a source `petstoreAPI` and mean different
documents.

Two keying rules follow from the runtime-expression grammar and are worth knowing:

- **`$workflows.<id>` state stays keyed by the bare workflowId** — the only form an expression can
  read it back by. If the entry document and a foreign document both define a workflow of one id
  and one run records both, the later write wins under that key (the same last-write-wins two
  same-document calls of one workflow already have). The cycle/depth guards, dependency
  memoization, and caches are *not* affected — internally every workflow is identified by its
  document URI together with its id (which is also how a foreign workflow displays in an error
  `path`: `<documentURI>#<workflowId>`).
- **`dependencyInputs` is keyed by the `dependsOn` entry as written** — the bare id for a
  same-document dependency, the whole `$sourceDescriptions.<name>.<workflowId>` expression for a
  cross-document one.

A bad reference throws `ExecutionError`: `invalid-workflow-reference` (a `$`-prefixed reference
that is not a `$sourceDescriptions` expression), `source-description-not-found` (the named source
is absent), `source-description-not-arazzo` (it resolves to a non-Arazzo document — e.g. a workflow
reference into an OpenAPI source), or `workflow-not-found` (the document does not define the id;
the message names which document was searched).

### Workflow-level default actions

A workflow's `successActions` / `failureActions` apply to every step as a **default**. A step that
declares its own `onSuccess` / `onFailure` **overrides** the corresponding workflow list wholesale.
There is no per-action merge, and success and failure fall back independently (a step may override
only its failure actions and still inherit the workflow's success actions).

Like the parameters below, this is inheritance rather than dispatch, and happens in
`ArazzoWorkflowNormalizer`: a normalized workflow's steps already carry the defaults they inherit,
so the executors only ever read a step's own `onSuccess` / `onFailure`. Presence is what the
override keys off, not content — a step declaring `onSuccess: []` has overridden the default with an
empty set of actions and inherits nothing, whereas a step omitting the key entirely inherits.

Both kinds of step take the defaults, including one targeting a `workflowId`.

### Workflow-level parameters

A workflow's `parameters` apply to every step it contains. Unlike the actions above these **merge**
rather than replace: the specification lets a step override an inherited parameter but says it "can
never remove" one, so each step ends up with the union of the two lists, its own declaration
winning.

This happens in `ArazzoWorkflowNormalizer` too — a normalized workflow's steps already carry what
they inherit, exactly as a normalized OpenAPI operation already carries the parameters it inherits
from its Path Item. Neither executor knows about it.

A parameter's identity is the **`(name, in)` pair**, not `name` alone — the rule ApiDOM applies for
that OpenAPI-side inheritance ("a unique parameter is defined by a combination of a name and
location"). So a step declaring a `trace` query parameter overrides an inherited `trace` query
parameter but leaves an inherited `trace` *header* in place; they are two parameters bound for two
places. Names are case-sensitive, per the specification. A step's own parameters lead the merged
list, again matching the OpenAPI side.

Inheritance copies the **declarations**, not resolved values, so a workflow-level `value` that is a
runtime expression is still evaluated **once per step, in that step's own context**. A workflow
parameter reading `$steps.login.outputs.token` therefore means what it looks like it means: each
step sees the state as it was entered, not a value frozen when the workflow began.

A step targeting a `workflowId` inherits them too. Such a step's parameters are workflow inputs
rather than parts of a request and carry no `in`, so an absent `in` forms its own identity and name
alone decides what overrides what. An inherited parameter that *does* carry an `in` still applies
there, per the specification's "when the step in context specifies a `workflowId`, then all
parameters map to workflow inputs" — it arrives as an input under its bare name.

> [!NOTE]
> Resolved values are keyed by `name` alone when they are handed to the client, so two parameters
> differing only in `in` collapse into one at that boundary — the **step's own** survives, since the
> merged list is read most-specific-first. That collapse predates workflow-level parameters (a
> single step can declare both) and is tracked separately; what matters here is that a step can
> never lose to something it inherited.

### Cancellation

Pass an `AbortSignal` as `signal` to cancel a run:

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const result = await executor.execute('authenticateAndOrderPet', {
  inputs: { username: 'user1', password: 'secret' },
  signal: controller.signal,
});
```

The signal is observed at every boundary in the call tree — before each step, before each **retry
attempt** of a step, before entering a sub-workflow or a `dependsOn` prerequisite — and during the
`retryAfter` waits between attempts, which the default timer cuts short rather than sitting out. It
is also forwarded to the transport, so the request in flight when the abort lands is cancelled
rather than merely awaited (the `HTTPClient` contract asks every transport to honor
`request.signal` — global fetch does it for free, since the request doubles as fetch init; an axios
or undici client passes `request.signal` through in one line). A transport that ignores it costs
one in-flight request: the run still stops at the next boundary.

An aborted run throws `ExecutionError` with `reason: 'aborted'`, naming the boundary it stopped at
(`workflowId`, `stepId`, and the `path` of workflows in progress) and carrying the signal's own
`reason` as the error's `cause`. One shape covers every case: a transport that honors the signal
rejects the request it was told to drop, and that rejection is reported as the cancellation it is
rather than as the `ClientError` a request failing on its own terms would raise — so a run
cancelled mid-flight reads the same as one cancelled between two steps, whichever transport is
plugged in. It does **not** resolve as a `failed` result: cancellation is not
something the steps did, and the steps that never ran were not decided against by any criteria.

A `signal` passed through `executeOptions` instead — the only channel before this option existed —
cancels the run just the same; the first-class option wins when both are given. `StepExecutor`
honors a `signal` in its execute options when used on its own too, throwing `aborted` instead of
dispatching a request that would be cancelled on the wire.

### Authoring errors vs. failed runs

Same split as `StepExecutor`: a step whose `successCriteria` go unmet with no redirecting action is
a normal `status: 'failed'` result, **not** a throw — as is a run whose `dependsOn` workflow failed.
Authoring errors throw `ExecutionError` — as does a cancelled run (`aborted`, above): an unknown
`workflowId` (`workflow-not-found`), a `goto` to a step that does not exist
(`goto-target-not-found`), a `goto` naming neither `stepId` nor `workflowId`
(`goto-target-missing`), a `retry` reference to a `stepId` this workflow does not declare
(`retry-target-not-found`), an action of an unknown `type` (`unknown-action-type`), a
present but malformed `steps` or `dependsOn` (`malformed-steps`, `malformed-dependsOn`), a step, a
`goto`, or a `retry` reference naming more than one target (`ambiguous-target`), a cycle or
over-deep nesting (`workflow-cycle`, `dependsOn-cycle`, `workflow-depth`), the step-budget
overflow above (`step-budget`), or a bad cross-document reference (`invalid-workflow-reference`,
`source-description-not-found`, `source-description-not-arazzo` — see
[Cross-document workflow references](#cross-document-workflow-references)).

A workflow's own `steps` and `dependsOn` lists are validated before any of its prerequisites run, so
those two mistakes never fire live requests on the way to throwing. Errors belonging to an
individual step — a step naming two targets, a `goto` to a step that does not exist, an unknown
action `type` — are raised when the run reaches that step, which means earlier steps have already
executed. That is deliberate: a bad step the run never reaches should not fail an otherwise valid
run.

## `StepExecutor`

Executes a single operation-shaped Arazzo step — one that invokes an OpenAPI operation — returning
its outcome. It orchestrates the full per-step pipeline:

1. locate the step's operation (`operationId` or `operationPath`);
2. resolve the step's `parameters` and `requestBody` against the pre-request context (`$inputs`,
   `$steps.*.outputs`, …);
3. delegate the call to `OpenAPIOperationExecutor`;
4. evaluate `successCriteria`, resolve `outputs`, and select the `onSuccess` / `onFailure` action
   against the post-request context (`$statusCode`, `$response.*`, `$request.*`, `$url`, `$method`).

`StepExecutor` **reads run state and mutates nothing**: it returns the resolved outputs and the
selected action for the caller to record and interpret. A step targeting a `workflowId` (a
sub-workflow) is not an operation step and throws; running sub-workflows is the `WorkflowExecutor`'s
concern — which still evaluates such a step's `successCriteria` and selects its actions through
this component's public `evaluateCriteria` / `selectActions`, so step semantics live in one place.

A step executor is bound to the document its steps belong to (the `document` option): plain
`operationId`s resolve against that document's source descriptions, and expressions resolve their
`$components` / `$sourceDescriptions` against it. `forDocument(document)` derives a sibling
executor bound to another document, sharing the registry and operation executor — how
`WorkflowExecutor` runs the steps of a
[cross-document workflow](#cross-document-workflow-references).

It delegates the located operation to an injected `OpenAPIOperationExecutor` (below) rather than
building one, so it stays agnostic to the operation pipeline and HTTP stack:

```js
import {
  DocumentRegistry,
  ArazzoWorkflowExtractor,
  ArazzoStepExtractor,
  WorkflowExecutionState,
  OpenAPIOperationExecutor,
  StepExecutor,
} from '@usearazzo/runner';

const registry = new DocumentRegistry();
const arazzoDoc = await registry.acquireEntryDocument(
  'https://ui.usearazzo.com/petstore-order-workflow.arazzo.yaml',
);

// pull a step out of the loaded Arazzo document by workflow + step id.
const workflow = new ArazzoWorkflowExtractor().extract(arazzoDoc, 'authenticateAndOrderPet');
const step = new ArazzoStepExtractor().extract(workflow, 'findAvailablePets');

const operationExecutor = new OpenAPIOperationExecutor();
const executor = new StepExecutor({ document: arazzoDoc, registry, operationExecutor });

// run state carries $inputs and accumulates $steps.*.outputs across a run.
const state = new WorkflowExecutionState({ inputs: { preferredPetStatus: 'available' } });

const outcome = await executor.execute(step, state);

console.log(outcome.successful); // true when every successCriterion passed
console.log(outcome.outputs); // resolved step outputs, keyed by name
console.log(outcome.action); // the selected onSuccess / onFailure action, or undefined

// a caller records the outputs so a later step can read $steps.findAvailablePets.outputs.*
state.setStepOutputs(outcome.stepId, outcome.outputs);
```

### Authoring errors vs. failed steps

The two are deliberately distinct:

- A **received response with unmet criteria** is a normal outcome: `successful: false`, no throw.
- **Malformed input** throws an `ExecutionError` (a step with no operation target, more than one
  mutually-exclusive target, a `workflowId` step, or an operation that cannot be located).
- A **cancelled run** throws too (`reason: 'aborted'`): an `AbortSignal` passed as `signal` in the
  execute options is checked before the request is dispatched, so an already-aborted run does not
  issue a request nobody is waiting for — and a request the transport drops mid-flight is reported
  as the cancellation rather than as the `ClientError` a request failing on its own terms raises.

## `OpenAPIOperationExecutor`

Executes a single OpenAPI operation and returns its normalized response. It is **Arazzo-agnostic**:
it neither locates the operation nor resolves runtime expressions. Given a canonical locator
(`{ document, jsonPointer }`) it runs a three-stage pipeline:

1. **build**: extracts the operation from its owning document, normalizes it, assembles a minimal
   standalone OpenAPI document containing just that operation, and builds the HTTP request from it:
   parameter serialization (style/explode), security application, and server resolution, across
   OpenAPI 2.0 through 3.1;
2. **send**: hands the built request to the pluggable `httpClient` transport (global fetch by
   default);
3. **normalize**: deserializes the raw WHATWG `Response` by content type into the runner's
   `OpenAPIOperationResponse`, the model runtime expressions and criteria see.

Because the executor builds the request explicitly and holds it, the response carries the request
**as actually sent** (`response.request`): final URL, method, headers, and serialized body. That way
`$url` / `$method` / `$request.*` are evaluated against reality, not intent.

A step's `requestBody` works the same against every supported version, including Swagger 2.0, which
has no request-body concept and carries the payload as a declared `body` or `formData` parameter
instead. Its `contentType` is matched ignoring case and media-type parameters, and a declared range
counts as covering a concrete type, so `application/json; charset=utf-8` names a declared
`application/json` and either names a declared `*/*`. The form media types are the exception, since
they decide how the body is encoded and so must be declared exactly. A `contentType` matching
nothing raises a `ClientError` rather than sending an empty or wrongly encoded body.

### Choosing the server

By default the request goes to the first server the operation declares (for Swagger 2.0, the
document's `schemes` + `host` + `basePath`), with a relative server resolved against the URL the
document itself was loaded from. That covers the common case with no options at all.

**`server`** changes where it goes, and does double duty:

```js
// selection: the value matches a declared server, so its variable defaults
// come along and only the ones you name are overridden
await executor.execute(locator, {
  server: 'https://{region}.example.com/{basePath}', // the raw template, as declared
  serverVariables: { region: 'us' }, // basePath keeps its declared default
});

// override: the value matches nothing declared, so it simply is the base URL
await executor.execute(locator, { server: 'https://staging.internal.test/api' });
```

There is deliberately **no silent fallback**: a `server` matching nothing declared is never quietly
swapped for the first declared one. The URL you name is the URL that gets called, so a typo fails
loudly at the network rather than succeeding against the wrong host. An override replaces the
declared base path along with the host, so include it (`…/api/v3`) if the API expects one.
Overriding works on Swagger 2.0 too; selection and `serverVariables` are 3.x-only, since 2.0 has no
server list and no URL templates.

Relative servers resolve against the URL the document was loaded from, which the executor already
knows, so a document fetched from `https://petstore3.swagger.io/api/v3/openapi.json` declaring
`servers: [{ url: '/api/v3' }]` needs no configuration at all. For a document loaded from disk, give
`server` an absolute URL.

### The `HTTPClient` seam

The transport is the extension point, and its contract is deliberately minimal: a function from the
built request to a WHATWG `Response`. The default, exported as `httpClientFetch`, is global fetch in
one line (`(request) => fetch(request.url, request)`) and is used when no `httpClient` is given:

```js
import { fetch, Agent } from 'undici';
import { OpenAPIOperationExecutor } from '@usearazzo/runner';

// the default transport, no configuration needed
const executor = new OpenAPIOperationExecutor();

// any HTTP stack drops in with a few lines: here undici with a dispatcher the
// global fetch cannot take (connection-pool tuning, a proxy, client certificates)
const dispatcher = new Agent({ connections: 128, keepAliveTimeout: 60_000 });

const pooledExecutor = new OpenAPIOperationExecutor({
  httpClient: (request) => fetch(request.url, { ...request, dispatcher }),
});

// or serve canned responses in a test: no network, no interception hooks
const offlineExecutor = new OpenAPIOperationExecutor({
  httpClient: async () =>
    new Response('[{"id":1,"status":"available"}]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
});
```

`httpClientFetch` is exported so a transport that only wants to add behavior around the network call
can delegate to it rather than re-implement fetch.

The contract:

- resolve with a `Response` for **every** HTTP status: a non-2xx is a valid Arazzo outcome judged by
  a step's `successCriteria`, never an error;
- throw only on genuine transport failure: the executor wraps it as a `ClientError` carrying the
  original error as `cause`;
- honor `request.signal` when present.

Response normalization runs on the executor's side of the seam for every client, so `$response.body`
semantics stay identical no matter which transport is plugged in.

### Request decoration (and authentication)

Arazzo is auth-agnostic (a workflow document says nothing about credentials), so the runner does not
model authentication either. Credentials are applied by decorating the outgoing request with a
`requestInterceptor`, which runs after the request is built and before it is sent, may be
synchronous or asynchronous, and may mutate the request or return (or resolve with) a replacement:

```js
const executor = new OpenAPIOperationExecutor({
  requestInterceptor: async (request) => {
    request.headers.Authorization = `Bearer ${await acquireToken()}`;
  },
});
```

A per-call `requestInterceptor` can also ride in the execute options bag; it runs after the
executor-level one.

Because the interceptor sets headers directly, it works regardless of how (or whether) the OpenAPI
document declares its security schemes. If you'd rather have credentials applied _from_ those
declarations, placed in the header, query, or cookie each scheme prescribes, `buildRequest`'s
`securities` option still passes through the execute options bag untouched; it is simply not part of
the typed surface.

Decoration via the interceptor, rather than inside a custom `httpClient`, is what makes the edits
part of the request record: the executor captures `response.request` (which feeds `$request.*` and
the trace) after the interceptors run and before the transport is called, so transport-side changes
are deliberately invisible to it.

### Standalone use

Because it is Arazzo-agnostic, the executor can be used **standalone**: with only an OpenAPI
document and an `operationId`, no Arazzo workflow involved. The operation index on the loaded
document maps an `operationId` to its JSON Pointer, which is all a locator needs:

```js
import { DocumentRegistry, OpenAPIOperationExecutor } from '@usearazzo/runner';

const registry = new DocumentRegistry();
const openapiDoc = await registry.acquire('https://petstore3.swagger.io/api/v3/openapi.json');

// build a canonical { document, jsonPointer } locator straight from the OpenAPI
// document; the operation index resolves an operationId to its JSON Pointer.
const locator = {
  document: openapiDoc,
  jsonPointer: openapiDoc.operationIndex.get('findPetsByStatus'),
};

const executor = new OpenAPIOperationExecutor();

// the operation's relative server resolves against the URL the document was
// loaded from, so there is nothing to configure.
const response = await executor.execute(locator, { parameters: { status: 'available' } });

console.log(response.status, response.body);
console.log(response.request.url); // the URL as actually sent
```

A non-2xx response is returned as data, not thrown; whether it counts as success is judged one level
up, by a step's `successCriteria`. Everything else throws with a named reason: malformed input (an
unlocatable operation, an unsupported OpenAPI version), a request that cannot be built (e.g. a
missing required parameter), and transport failures. The latter two arrive as `ClientError`.

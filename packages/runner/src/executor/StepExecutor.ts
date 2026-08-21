import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isStringElement } from '@speclynx/apidom-datamodel';
import { isCriterionElement, type StepElement } from '@speclynx/apidom-ns-arazzo-1';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import type DocumentRegistry from '../registry/DocumentRegistry.ts';
import type { OpenAPIOperationExecuteOptions } from './OpenAPIOperationExecutor.ts';
import type OpenAPIOperationResponse from '../client/OpenAPIOperationResponse.ts';
import type {
  RuntimeExpressionContext,
  RuntimeExpressionRequestContext,
  RuntimeExpressionResponseContext,
} from '../expression/RuntimeExpressionContext.ts';
import RuntimeExpressionEvaluator from '../expression/RuntimeExpressionEvaluator.ts';
import CriterionEvaluator from '../criterion/CriterionEvaluator.ts';
import OpenAPIOperationParameterResolver from '../resolver/OpenAPIOperationParameterResolver.ts';
import RequestBodyResolver, { type ResolvedRequestBody } from '../resolver/RequestBodyResolver.ts';
import OutputResolver from '../resolver/OutputResolver.ts';
import ActionResolver, {
  type CriterionPredicate,
  type SelectedAction,
} from '../action/ActionResolver.ts';
import OpenAPIOperationExecutor from './OpenAPIOperationExecutor.ts';
import OpenAPIOperationLocatorNormalizer, {
  type OpenAPIOperationLocator,
} from './OpenAPIOperationLocatorNormalizer.ts';
import ExecutionError from '../errors/ExecutionError.ts';
import { readAbortSignal, throwIfAborted } from './abort.ts';

/**
 * The mutually exclusive fields by which a step names its target. A step may
 * declare at most one. Extend this as the Arazzo Specification adds targets
 * (e.g. `channelPath` in 1.1.0) so every exclusivity check stays complete —
 * both this module's and the workflow executor's, which makes the same check
 * for a step it intercepts before {@link StepExecutor.execute}.
 * @internal
 */
export const STEP_TARGET_FIELDS = ['operationId', 'operationPath', 'workflowId'] as const;

/**
 * A read-only source of the runtime expression context for a step.
 *
 * The step executor only reads accumulated run state — it produces the
 * pre-request context (`toContext()`) and the post-request context
 * (`toContext(request, response)`) — and never mutates it, so it depends on
 * this narrow interface rather than the full execution state.
 * @public
 */
export interface ContextSource {
  toContext(
    request?: RuntimeExpressionContext['request'],
    response?: RuntimeExpressionResponseContext,
  ): RuntimeExpressionContext;
}

/**
 * Options for the StepExecutor.
 * @public
 */
export interface StepExecutorOptions {
  /**
   * The Arazzo document the steps belong to — typically the entry document;
   * used to resolve each step's operation locator against its source
   * descriptions, and to resolve `$components` / `$sourceDescriptions` in
   * expressions. For a step of a workflow in another document, derive a
   * sibling executor with {@link StepExecutor.forDocument}.
   */
  readonly document: ArazzoDocument;
  /**
   * The document registry holding the already-loaded source documents.
   */
  readonly registry: DocumentRegistry;
  /**
   * The operation engine each step's located operation is delegated to. Build it
   * with the client factory (or a deterministic stub in tests) and pass it in —
   * the step executor is agnostic to how the operation reaches the live API.
   */
  readonly operationExecutor: OpenAPIOperationExecutor;
}

/**
 * The outcome of executing a single step.
 * @public
 */
export interface StepExecutionResult {
  readonly stepId: string;
  readonly response: OpenAPIOperationResponse;
  readonly successful: boolean;
  readonly outputs: Record<string, unknown>;
  /**
   * The action to take for this outcome — the first of {@link StepExecutionResult.matchedActions},
   * or `undefined` when none matched (the caller then applies the path default).
   */
  readonly action: SelectedAction | undefined;
  /**
   * Every `onSuccess` / `onFailure` action whose criteria matched this outcome,
   * in list order. Usually the caller acts on `action` (the first); the workflow
   * executor walks the full list to honor "retryLimit exhausted prior to
   * subsequent failure actions" — falling from an exhausted `retry` to the next
   * matching action. Empty when none matched.
   */
  readonly matchedActions: readonly SelectedAction[];
}

/**
 * Executes a single Arazzo step that invokes an OpenAPI operation.
 *
 * The pipeline locates the step's operation (`operationId` / `operationPath`),
 * resolves the step's parameters and request body against the pre-request
 * context, delegates to {@link OpenAPIOperationExecutor} to run the located
 * operation, then evaluates `successCriteria`, resolves `outputs`, and selects
 * the `onSuccess`/`onFailure` action against the post-request context.
 *
 * It reads run state through a {@link ContextSource} and mutates nothing — the
 * caller records the returned outputs and interprets the returned action. A step
 * targeting a `workflowId` (a sub-workflow) is not an operation step and throws
 * {@link ExecutionError}; running sub-workflows is the workflow executor's
 * concern. A received response with unmet criteria is a normal
 * `successful: false` outcome; malformed input (e.g. an invalid criterion or
 * expression) throws, as does a run the caller has cancelled through an
 * `AbortSignal` in the execute options.
 * @public
 */
class StepExecutor {
  readonly #document: ArazzoDocument;
  readonly #registry: DocumentRegistry;
  readonly #locatorNormalizer: OpenAPIOperationLocatorNormalizer;
  readonly #operationExecutor: OpenAPIOperationExecutor;
  readonly #parameterResolver = new OpenAPIOperationParameterResolver();
  readonly #requestBodyResolver = new RequestBodyResolver();
  readonly #outputResolver = new OutputResolver();
  readonly #criterionEvaluator = new CriterionEvaluator();
  readonly #actionResolver = new ActionResolver();

  constructor(options: StepExecutorOptions) {
    this.#document = options.document;
    this.#registry = options.registry;
    this.#locatorNormalizer = new OpenAPIOperationLocatorNormalizer(options.registry);
    this.#operationExecutor = options.operationExecutor;
  }

  /**
   * A step executor bound to the given document, sharing this one's registry
   * and operation executor — this instance itself when the document is
   * already the one it is bound to.
   *
   * A step executor's identity includes the document its steps belong to: a
   * plain `operationId` resolves against *that* document's source
   * descriptions, and `$components` / `$sourceDescriptions` expressions
   * resolve against it too. A cross-document workflow run therefore derives
   * a sibling per foreign document rather than re-pointing this one.
   */
  forDocument(document: ArazzoDocument): StepExecutor {
    if (document === this.#document) return this;

    return new StepExecutor({
      document,
      registry: this.#registry,
      operationExecutor: this.#operationExecutor,
    });
  }

  /**
   * Executes the step against the given run state, returning its outcome.
   *
   * `executeOptions` is an opaque bag passed through to the operation executor
   * (e.g. a `server` to run the step against, or an `AbortSignal`). The
   * Arazzo-derived options (`operationId`, `parameters`, `requestBody`) always
   * take precedence over it.
   *
   * A `signal` in that bag is honored here and not only at the transport: an
   * already-aborted signal throws `reason: 'aborted'` instead of issuing a
   * request nobody is waiting for, whose wire-level cancellation would surface
   * as a transport {@link ClientError} — a request that failed on its own terms
   * — rather than as the withdrawal it is.
   */
  async execute(
    step: StepElement,
    state: ContextSource,
    executeOptions: Record<string, unknown> = {},
  ): Promise<StepExecutionResult> {
    const stepId = toValue(step.stepId) as string;

    // a step's target fields are mutually exclusive; declaring more than one is
    // malformed and has no defined resolution.
    const declaredTargets = STEP_TARGET_FIELDS.filter((field) => isStringElement(step[field]));
    if (declaredTargets.length > 1) {
      throw new ExecutionError(
        `Step "${stepId}" declares more than one of ${STEP_TARGET_FIELDS.join(', ')} (mutually exclusive)`,
        { stepId, reason: 'ambiguous-target' },
      );
    }

    if (isStringElement(step.workflowId)) {
      throw new ExecutionError(`Step "${stepId}" targets a workflowId; use the workflow executor`, {
        stepId,
        reason: 'workflow-step',
      });
    }

    // locate which operation the step invokes — reduced to a (document, JSON
    // Pointer) locator that the operation executor extracts, normalizes,
    // assembles into a standalone doc, and runs.
    const locator = await this.#locateOperation(step, stepId);

    // resolve parameters and request body against the pre-request context.
    // keyed by '{in}.{name}' rather than bare name, so two parameters that
    // legally differ only in their location each reach their own place.
    const scope = { stepId };
    const preContext = state.toContext();
    const parameters = this.#parameterResolver.resolve(
      step.parameters,
      (expression) => this.#evaluate(preContext, expression),
      scope,
    );
    const requestBody = this.#requestBodyResolver.resolve(
      step.requestBody,
      (expression) => this.#evaluate(preContext, expression),
      scope,
    );

    // checked here rather than on entry: locating the operation and resolving
    // the expressions above are awaited, so a run cancelled during them would
    // still reach this line — and this is the last moment before the step has a
    // live side effect. The signal stays in the bag, so a request already in
    // flight is aborted by the transport as before.
    const signal = readAbortSignal(executeOptions);
    throwIfAborted(signal, { stepId });

    // the Arazzo-derived parameters and request body are spread after the opaque
    // executeOptions bag so they take precedence over it. the operation executor
    // then forces the operation target on top of this before executing.
    let response: OpenAPIOperationResponse;
    try {
      response = await this.#operationExecutor.execute(locator, {
        ...executeOptions,
        parameters,
        ...this.#requestBodyOptions(requestBody),
      });
    } catch (error: unknown) {
      // a transport that honors the signal rejects the request it was told to
      // drop, which the operation executor wraps as a `ClientError` — the shape
      // reserved for a request that failed on its own terms. Cancelled while
      // cancelled, it did not: reporting it as the abort keeps one error shape
      // whether the run was withdrawn between two steps or mid-flight, and keeps
      // the whole feature from reading differently per transport.
      throwIfAborted(signal, { stepId });
      throw error;
    }

    // evaluate criteria, outputs, and the next action against the post-request
    // context (with $request / $url / $method and $response / $statusCode).
    const postContext = state.toContext(
      this.#requestContext(response),
      this.#responseContext(response),
    );
    const successful = this.evaluateCriteria(step, postContext);
    const outputs = this.#outputResolver.resolve(
      step.outputs,
      (expression) => this.#evaluate(postContext, expression),
      scope,
    );
    const matchedActions = this.selectActions(step, successful, postContext);

    return { stepId, response, successful, outputs, action: matchedActions[0], matchedActions };
  }

  /**
   * The request-body execute options for the step, as a typed partial to spread
   * into the client options.
   *
   * Empty when the step has no request body; the `requestContentType` key is
   * present only when a content type was resolved, so it is omitted rather than
   * spread as `undefined`.
   */
  #requestBodyOptions(
    requestBody: ResolvedRequestBody | undefined,
  ): Partial<OpenAPIOperationExecuteOptions> {
    if (requestBody === undefined) return {};

    return requestBody.contentType === undefined
      ? { requestBody: requestBody.payload }
      : { requestBody: requestBody.payload, requestContentType: requestBody.contentType };
  }

  async #locateOperation(step: StepElement, stepId: string): Promise<OpenAPIOperationLocator> {
    if (isStringElement(step.operationId)) {
      return this.#locatorNormalizer.normalizeOperationId(
        toValue(step.operationId) as string,
        this.#document,
      );
    }
    if (isStringElement(step.operationPath)) {
      return this.#locatorNormalizer.normalizeOperationPath(
        toValue(step.operationPath) as string,
        this.#document,
      );
    }
    throw new ExecutionError(`Step "${stepId}" has no operationId or operationPath`, {
      stepId,
      reason: 'missing-operation',
    });
  }

  /**
   * Evaluates the step's `successCriteria`; all criteria must pass. A step with
   * no criteria succeeds on a received response.
   *
   * Public for the same reason as {@link StepExecutor.selectActions}: a step
   * targeting a `workflowId` is run by the workflow executor and never reaches
   * {@link StepExecutor.execute}, but its criteria are still the author's
   * assertion about the step and must be evaluated somewhere.
   */
  evaluateCriteria(step: StepElement, context: RuntimeExpressionContext): boolean {
    const criteria = step.successCriteria;
    // no (or non-array) successCriteria: the step succeeds on a received response.
    if (!isArrayElement(criteria)) return true;

    for (const criterion of criteria) {
      if (!isCriterionElement(criterion)) continue;
      const met = this.#criterionEvaluator.evaluate(criterion, (expression) =>
        this.#evaluate(context, expression),
      );
      if (!met) return false;
    }
    return true;
  }

  /**
   * Selects every matching `onSuccess` / `onFailure` action for the outcome, in
   * list order, gating each action's criteria against the context.
   *
   * The step's own list is the whole story here: a step that declares none of
   * its own already carries the workflow-level defaults, inherited by
   * {@link ArazzoWorkflowNormalizer} — the same place a step's inherited
   * `parameters` come from — so there is no fallback left to apply at selection
   * time.
   *
   * The full matching list (not just the first) is returned so the caller can
   * honor "retryLimit exhausted prior to subsequent failure actions"; the common
   * caller simply takes the first.
   *
   * Public because selecting a step's actions is meaningful beyond running one:
   * the workflow executor selects them for a step targeting a `workflowId`, which
   * it runs itself and which therefore never reaches
   * {@link StepExecutor.execute}. Both callers reach the criteria evaluator and
   * the expression context through this one method rather than wiring their own.
   */
  selectActions(
    step: StepElement,
    successful: boolean,
    context: RuntimeExpressionContext,
  ): SelectedAction[] {
    const isCriterionMet: CriterionPredicate = (criterion) =>
      this.#criterionEvaluator.evaluate(criterion, (expression) =>
        this.#evaluate(context, expression),
      );
    const scope = { stepId: toValue(step.stepId) as string };

    return successful
      ? this.#actionResolver.resolveOnSuccess(step.onSuccess, isCriterionMet, scope)
      : this.#actionResolver.resolveOnFailure(step.onFailure, isCriterionMet, scope);
  }

  /**
   * Resolves a runtime expression leniently against a context, forwarding
   * `$components` / `$sourceDescriptions` resolution to the document and
   * registry.
   */
  #evaluate(context: RuntimeExpressionContext, expression: string): unknown {
    return new RuntimeExpressionEvaluator(context, {
      strict: false,
      document: this.#document,
      registry: this.#registry,
    }).evaluate(expression);
  }

  #responseContext(response: OpenAPIOperationResponse): RuntimeExpressionResponseContext {
    return {
      statusCode: response.status,
      header: response.headers,
      body: response.body,
    };
  }

  /**
   * The request context (`$url`, `$method`, `$request.header.*`,
   * `$request.body`) from the request the client actually sent, or `undefined`
   * when the client did not report one.
   */
  #requestContext(response: OpenAPIOperationResponse): RuntimeExpressionRequestContext | undefined {
    const request = response.request;
    if (request === undefined) return undefined;
    return {
      url: request.url,
      method: request.method,
      header: request.headers,
      body: request.body,
    };
  }
}

export default StepExecutor;

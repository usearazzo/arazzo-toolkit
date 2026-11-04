import type { ApiDOMErrorOptions } from '@speclynx/apidom-error';

import ArazzoRunnerError from './ArazzoRunnerError.ts';

/**
 * Carries a `reason`, one of the class's static reason fields.
 *
 * Every static on this class is a reason: {@link ResolverErrorReason} is
 * derived from the class's own statics, so a non-reason static would join the
 * union.
 * @public
 */
class ResolverError extends ArazzoRunnerError {
  /** A parameter cannot be delivered unambiguously at its location. */
  static readonly AmbiguousDelivery = 'ambiguous-delivery' as const;
  /** An output or a request body payload holds a value that is not a valid runtime expression. */
  static readonly InvalidExpression = 'invalid-expression' as const;
  /** A parameter's location (`in`) is not one of the known locations. */
  static readonly InvalidLocation = 'invalid-location' as const;
  /** An `onSuccess`/`onFailure` list holds an entry that is not a Success/Failure Action Object. */
  static readonly MalformedActionEntry = 'malformed-action-entry' as const;
  /** A step's `onSuccess` or `onFailure` is present but is not a list. */
  static readonly MalformedActions = 'malformed-actions' as const;
  /** A step's `successCriteria` or an action's `criteria` is present but is not a list. */
  static readonly MalformedCriteria = 'malformed-criteria' as const;
  /** A criteria list holds an entry that is not a Criterion Object. */
  static readonly MalformedCriterion = 'malformed-criterion' as const;
  /** A parameter's location (`in`) is not a string. */
  static readonly MalformedLocation = 'malformed-location' as const;
  /** A step's or workflow's `outputs` is present but is not a map. */
  static readonly MalformedOutputs = 'malformed-outputs' as const;
  /** `parameters` is present but is not a list. */
  static readonly MalformedParameters = 'malformed-parameters' as const;
  /** `requestBody.replacements` is present but is not a list. */
  static readonly MalformedReplacements = 'malformed-replacements' as const;
  /** `requestBody` is present but is not a map. */
  static readonly MalformedRequestBody = 'malformed-request-body' as const;
  /** A parameter of a step that targets an operation declares no location (`in`). */
  static readonly MissingLocation = 'missing-location' as const;
  /** A parameter has a missing or non-string `name`. */
  static readonly MissingName = 'missing-name' as const;
  /** A runtime expression in the request body did not resolve. */
  static readonly UnresolvedExpression = 'unresolved-expression' as const;
  /** A `requestBody` replacement target does not resolve in the payload. */
  static readonly UnresolvedTarget = 'unresolved-target' as const;
  /** A `requestBody` replacement target is not a JSON Pointer. */
  static readonly UnsupportedTarget = 'unsupported-target' as const;

  declare readonly stepId?: string;
  declare readonly workflowId?: string;
  declare readonly target?: string;
  declare readonly reason?: ResolverErrorReason;

  constructor(
    message?: string,
    options?: ApiDOMErrorOptions & { readonly reason?: ResolverErrorReason },
  ) {
    super(message, options);
  }
}

/**
 * One of the reasons a {@link ResolverError} carries: a `ResolverError`
 * static such as `ResolverError.MalformedParameters`.
 * @public
 */
export type ResolverErrorReason = (typeof ResolverError)[Exclude<
  keyof typeof ResolverError,
  keyof typeof ArazzoRunnerError | 'prototype'
>];

export default ResolverError;

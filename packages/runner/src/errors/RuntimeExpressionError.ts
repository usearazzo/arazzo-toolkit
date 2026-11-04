import type { ApiDOMErrorOptions } from '@speclynx/apidom-error';

import ArazzoRunnerError from './ArazzoRunnerError.ts';

/**
 * Carries a `reason`, one of the class's static reason fields.
 *
 * Every static on this class is a reason: {@link RuntimeExpressionErrorReason}
 * is derived from the class's own statics, so a non-reason static would join
 * the union.
 * @public
 */
class RuntimeExpressionError extends ArazzoRunnerError {
  /** The expression is not a valid runtime expression. */
  static readonly InvalidExpression = 'invalid-expression' as const;
  /** The runtime expression parser failed on the expression. */
  static readonly ParseError = 'parse-error' as const;
  /**
   * The expression reads HTTP data (`$statusCode`, `$url`, `$method`, `$request`,
   * `$response`) in a step that calls a workflow and so made no HTTP call.
   */
  static readonly UnavailableExpression = 'unavailable-expression' as const;
  /** The expression could not be resolved against the evaluation context. */
  static readonly UnresolvedReference = 'unresolved-reference' as const;
  /** The parsed expression contains a node the evaluator does not support. */
  static readonly UnsupportedNode = 'unsupported-node' as const;

  declare readonly expression?: string;
  declare readonly reason?: RuntimeExpressionErrorReason;

  constructor(
    message?: string,
    options?: ApiDOMErrorOptions & { readonly reason?: RuntimeExpressionErrorReason },
  ) {
    super(message, options);
  }
}

/**
 * One of the reasons a {@link RuntimeExpressionError} carries: a
 * `RuntimeExpressionError` static such as `RuntimeExpressionError.ParseError`.
 * @public
 */
export type RuntimeExpressionErrorReason = (typeof RuntimeExpressionError)[Exclude<
  keyof typeof RuntimeExpressionError,
  keyof typeof ArazzoRunnerError | 'prototype'
>];

export default RuntimeExpressionError;

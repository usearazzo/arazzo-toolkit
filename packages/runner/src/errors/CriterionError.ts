import type { ApiDOMErrorOptions } from '@speclynx/apidom-error';

import ArazzoRunnerError from './ArazzoRunnerError.ts';

/**
 * Carries a `reason`, one of the class's static reason fields.
 *
 * Every static on this class is a reason: {@link CriterionErrorReason} is
 * derived from the class's own statics, so a non-reason static would join the
 * union.
 * @public
 */
class CriterionError extends ArazzoRunnerError {
  /** The element is not a Criterion Object. */
  static readonly InvalidCriterion = 'invalid-criterion' as const;
  /** The `condition` is missing or empty. */
  static readonly MissingCondition = 'missing-condition' as const;
  /** The `type` is present but unreadable. */
  static readonly InvalidType = 'invalid-type' as const;
  /** The `type` names no known criterion type. */
  static readonly UnknownType = 'unknown-type' as const;
  /** The expression type `version` is present but not a string. */
  static readonly InvalidVersion = 'invalid-version' as const;
  /** The expression type `version` is not the one this runner supports. */
  static readonly UnsupportedVersion = 'unsupported-version' as const;
  /** The `context` is not a runtime expression. */
  static readonly InvalidContext = 'invalid-context' as const;
  /** A `regex`, `jsonpath` or `xpath` criterion has no `context`. */
  static readonly MissingContext = 'missing-context' as const;
  /** The `simple` condition cannot be parsed. */
  static readonly InvalidSimple = 'invalid-simple' as const;
  /** The `regex` condition is not a valid regular expression. */
  static readonly InvalidRegex = 'invalid-regex' as const;
  /** The `jsonpath` condition is not a valid JSONPath query. */
  static readonly InvalidJSONPath = 'invalid-jsonpath' as const;
  /** The `xpath` condition is invalid or fails to evaluate. */
  static readonly InvalidXPath = 'invalid-xpath' as const;
  /** The resolved `xpath` context is not XML. */
  static readonly InvalidXPathContext = 'invalid-xpath-context' as const;

  declare readonly condition?: string;
  declare readonly type?: string;
  declare readonly reason?: CriterionErrorReason;

  constructor(
    message?: string,
    options?: ApiDOMErrorOptions & { readonly reason?: CriterionErrorReason },
  ) {
    super(message, options);
  }
}

/**
 * One of the reasons a {@link CriterionError} carries: a `CriterionError`
 * static such as `CriterionError.InvalidRegex`.
 *
 * Structural reasons mark a criterion that is malformed as written; they are
 * thrown as a plain `CriterionError`. Evaluation reasons (`InvalidSimple`,
 * `InvalidRegex`, `InvalidJSONPath`, `InvalidXPath`, `InvalidXPathContext`) mark
 * a condition that cannot be evaluated; they are thrown as a
 * {@link CriterionEvaluationError}, which `CriterionEvaluator` turns into an
 * unmet criterion.
 * @public
 */
export type CriterionErrorReason = (typeof CriterionError)[Exclude<
  keyof typeof CriterionError,
  keyof typeof ArazzoRunnerError | 'prototype'
>];

export default CriterionError;

/**
 * The `reason` a {@link CriterionError} carries.
 *
 * Structural reasons mark a criterion that is malformed as written; they are
 * thrown as a plain `CriterionError`. Evaluation reasons (`InvalidSimple`,
 * `InvalidRegex`, `InvalidJSONPath`, `InvalidXPath`, `InvalidXPathContext`) mark
 * a condition that cannot be evaluated; they are thrown as a
 * {@link CriterionEvaluationError}, which `CriterionEvaluator` turns into an
 * unmet criterion.
 * @public
 */
const CriterionErrorReason = {
  /** The element is not a Criterion Object. */
  InvalidCriterion: 'invalid-criterion',
  /** The `condition` is missing or empty. */
  MissingCondition: 'missing-condition',
  /** The `type` is present but unreadable. */
  InvalidType: 'invalid-type',
  /** The `type` names no known criterion type. */
  UnknownType: 'unknown-type',
  /** The expression type `version` is present but not a string. */
  InvalidVersion: 'invalid-version',
  /** The expression type `version` is not the one this runner supports. */
  UnsupportedVersion: 'unsupported-version',
  /** The `context` is not a runtime expression. */
  InvalidContext: 'invalid-context',
  /** A `regex`, `jsonpath` or `xpath` criterion has no `context`. */
  MissingContext: 'missing-context',
  /** The `simple` condition cannot be parsed. */
  InvalidSimple: 'invalid-simple',
  /** The `regex` condition is not a valid regular expression. */
  InvalidRegex: 'invalid-regex',
  /** The `jsonpath` condition is not a valid JSONPath query. */
  InvalidJSONPath: 'invalid-jsonpath',
  /** The `xpath` condition is invalid or fails to evaluate. */
  InvalidXPath: 'invalid-xpath',
  /** The resolved `xpath` context is not XML. */
  InvalidXPathContext: 'invalid-xpath-context',
} as const;

/**
 * One of the `CriterionErrorReason` values.
 * @public
 */
type CriterionErrorReason = (typeof CriterionErrorReason)[keyof typeof CriterionErrorReason];

export default CriterionErrorReason;

import CriterionError from './CriterionError.ts';

/**
 * A criterion condition that cannot be evaluated: a syntax error in the
 * condition, a context the condition cannot apply to, or an error raised while
 * evaluating it. The type-specific criterion evaluators throw it;
 * `CriterionEvaluator` turns it into an unmet criterion, as Arazzo 1.1.0
 * requires.
 * @public
 */
class CriterionEvaluationError extends CriterionError {}

export default CriterionEvaluationError;

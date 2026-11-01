import ArazzoRunnerError from './ArazzoRunnerError.ts';
import type CriterionErrorReason from '../criterion/CriterionErrorReason.ts';

/** @public */
class CriterionError extends ArazzoRunnerError {
  declare readonly condition?: string;
  declare readonly type?: string;
  declare readonly reason?: CriterionErrorReason;
}

export default CriterionError;

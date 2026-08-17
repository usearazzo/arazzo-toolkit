import ArazzoRunnerError from './ArazzoRunnerError.ts';

/** @public */
class ResolverError extends ArazzoRunnerError {
  declare readonly stepId?: string;
  declare readonly workflowId?: string;
  declare readonly target?: string;
  declare readonly reason?: string;
}

export default ResolverError;

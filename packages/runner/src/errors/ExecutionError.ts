import ArazzoRunnerError from './ArazzoRunnerError.ts';

/** @public */
class ExecutionError extends ArazzoRunnerError {
  declare readonly stepId?: string;
  declare readonly workflowId?: string;
  declare readonly reason?: string;
  /**
   * The chain of workflowIds the error concerns — the loop A → B → A for a
   * cycle, or the call chain in progress when a budget ran out.
   */
  declare readonly path?: readonly string[];
}

export default ExecutionError;

import ArazzoRunnerError from './ArazzoRunnerError.ts';

/** @public */
class DocumentLoadError extends ArazzoRunnerError {
  declare readonly uri?: string;
}

export default DocumentLoadError;

import { ApiDOMError, type ApiDOMErrorOptions } from '@speclynx/apidom-error';

/**
 * Error thrown by `parseArazzo` and `parseOpenAPI` when parsing fails for any
 * reason. The original error is available via the `cause` property.
 * @public
 */
class ParseError extends ApiDOMError {
  constructor(message?: string, options?: ApiDOMErrorOptions) {
    super(message, options);
  }
}

export default ParseError;

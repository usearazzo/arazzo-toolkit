import { ApiDOMError, type ApiDOMErrorOptions } from '@speclynx/apidom-error';

/**
 * Error thrown when resolving an Arazzo or OpenAPI document or element fails.
 * @public
 */
class ResolveError extends ApiDOMError {
  constructor(message?: string, options?: ApiDOMErrorOptions) {
    super(message, options);
  }
}

export default ResolveError;

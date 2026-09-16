import { ApiDOMError, type ApiDOMErrorOptions } from '@speclynx/apidom-error';

/**
 * Error thrown when bundling an Arazzo or OpenAPI document fails.
 * @public
 */
class BundleError extends ApiDOMError {
  constructor(message?: string, options?: ApiDOMErrorOptions) {
    super(message, options);
  }
}

export default BundleError;

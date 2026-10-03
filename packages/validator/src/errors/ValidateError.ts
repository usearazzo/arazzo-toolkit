import { ApiDOMError, type ApiDOMErrorOptions } from '@speclynx/apidom-error';

/**
 * Error thrown by `validateURI` when the document cannot be fetched. Problems
 * found in the document itself are reported as diagnostics, not thrown. The
 * original error is available via the `cause` property.
 * @public
 */
class ValidateError extends ApiDOMError {
  constructor(message?: string, options?: ApiDOMErrorOptions) {
    super(message, options);
  }
}

export default ValidateError;

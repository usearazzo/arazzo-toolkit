import type { ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';

/**
 * Base URI, media type and seeded ReferenceSet derived from an element
 * before a reference operation (dereference, resolve, bundle) runs on it.
 */
export interface ElementContext {
  readonly baseURI: string | undefined;
  readonly mediaType: string;
  readonly refSet: ReferenceSet;
  /**
   * Names the input that lacked a base URI. Set only when `baseURI` is `undefined`
   * because neither `retrievalURI` metadata nor `resolve.baseURI` was available;
   * the caller turns it into its own typed error.
   */
  readonly missingBaseURI?: 'ParseResultElement' | 'child element';
}

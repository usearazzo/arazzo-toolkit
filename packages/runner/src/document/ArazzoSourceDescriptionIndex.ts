import type { SourceDescriptionElement } from '@speclynx/apidom-ns-arazzo-1';

/**
 * Unique name of a source description within an Arazzo document.
 * @public
 */
export type SourceDescriptionName = string;

/**
 * One indexed source description: the parsed element and its canonical URI —
 * already resolved against the owning document's base URI, in the exact form
 * the document registry keys on — or `undefined` for a source with no
 * resolvable `url`.
 * @public
 */
export interface SourceDescriptionEntry {
  readonly element: SourceDescriptionElement;
  readonly uri: string | undefined;
}

/**
 * Index mapping a source description name to its element and canonical URI in
 * an Arazzo document.
 * @public
 */
class ArazzoSourceDescriptionIndex extends Map<SourceDescriptionName, SourceDescriptionEntry> {}

export default ArazzoSourceDescriptionIndex;

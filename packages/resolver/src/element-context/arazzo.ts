import { Element, isParseResultElement, ParseResultElement } from '@speclynx/apidom-datamodel';
import { Reference, ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';
import type { ApiDOMReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import { isArazzoSpecification1Element, mediaTypes } from '@speclynx/apidom-ns-arazzo-1';

import type { ElementContext } from './ElementContext.ts';

/**
 * Derives the base URI, media type and seeded ReferenceSet for an Arazzo element.
 *
 * Supported scenarios:
 * - ParseResultElement with retrievalURI metadata: baseURI derived automatically
 * - ParseResultElement without retrievalURI: requires `options.resolve.baseURI`
 * - Child element (e.g., WorkflowElement) with `options.dereference.strategyOpts.parseResult`:
 *   the refSet is seeded with the element and the root document, and `options.resolve.baseURI`
 *   is required if the parseResult lacks retrievalURI metadata
 */
export function elementContext(element: Element, options: ApiDOMReferenceOptions): ElementContext {
  const refSet = options.dereference?.refSet ?? new ReferenceSet();
  let baseURI = options.resolve?.baseURI;
  let mediaType: string = 'text/plain';

  if (refSet.size === 0) {
    if (isParseResultElement(element)) {
      if (isArazzoSpecification1Element(element.api)) {
        mediaType = mediaTypes.latest();
      }
      if (element.hasMetaProperty('retrievalURI')) {
        baseURI = element.meta.get('retrievalURI') as string;
      } else if (!baseURI) {
        return { baseURI: undefined, mediaType, refSet, missingBaseURI: 'ParseResultElement' };
      }
    } else if (isParseResultElement(options.dereference?.strategyOpts?.parseResult)) {
      // a child element needs the root document in the refSet for component resolution
      const { parseResult } = options.dereference.strategyOpts;
      let rootURI: string;

      if (isArazzoSpecification1Element(parseResult.api)) {
        mediaType = mediaTypes.latest();
      }

      if (parseResult.hasMetaProperty('retrievalURI')) {
        rootURI = parseResult.meta.get('retrievalURI') as string;
      } else if (baseURI) {
        rootURI = baseURI;
      } else {
        return { baseURI: undefined, mediaType, refSet, missingBaseURI: 'child element' };
      }

      const elementReference = new Reference({
        uri: `${rootURI}#fragment`,
        value: new ParseResultElement([element]),
      });
      const rootReference = new Reference({ uri: rootURI, value: parseResult });

      refSet.add(elementReference).add(rootReference);
      baseURI = rootURI;
    }
  }

  return { baseURI, mediaType, refSet };
}

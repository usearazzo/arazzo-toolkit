import { Element, isParseResultElement, ParseResultElement } from '@speclynx/apidom-datamodel';
import { Reference, ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';
import type { ApiDOMReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import { isSwaggerElement, mediaTypes as openApi2MediaTypes } from '@speclynx/apidom-ns-openapi-2';
import {
  isOpenApi3_0Element,
  mediaTypes as openApi3_0MediaTypes,
} from '@speclynx/apidom-ns-openapi-3-0';
import {
  isOpenApi3_1Element,
  mediaTypes as openApi3_1MediaTypes,
} from '@speclynx/apidom-ns-openapi-3-1';

import type { ElementContext } from './ElementContext.ts';

/**
 * Checks if the element is a valid OpenAPI specification element.
 */
export function isOpenApiElement(element: unknown): boolean {
  return isSwaggerElement(element) || isOpenApi3_0Element(element) || isOpenApi3_1Element(element);
}

/**
 * Gets the appropriate mediaType for an OpenAPI element.
 */
function inferOpenApiMediaType(element: unknown): string {
  if (isSwaggerElement(element)) {
    return openApi2MediaTypes.latest();
  }
  if (isOpenApi3_0Element(element)) {
    return openApi3_0MediaTypes.latest();
  }
  if (isOpenApi3_1Element(element)) {
    return openApi3_1MediaTypes.latest();
  }
  return 'text/plain';
}

/**
 * Derives the base URI, media type and seeded ReferenceSet for an OpenAPI element.
 *
 * Supported scenarios:
 * - ParseResultElement with retrievalURI metadata: baseURI derived automatically
 * - ParseResultElement without retrievalURI: requires `options.resolve.baseURI`
 * - Child element (e.g., PathItemElement) with `options.dereference.strategyOpts.parseResult`:
 *   the refSet is seeded with the element and the root document, and `options.resolve.baseURI`
 *   is required if the parseResult lacks retrievalURI metadata
 */
export function elementContext(element: Element, options: ApiDOMReferenceOptions): ElementContext {
  const refSet = options.dereference?.refSet ?? new ReferenceSet();
  let baseURI = options.resolve?.baseURI;
  let mediaType: string = 'text/plain';

  if (refSet.size === 0) {
    if (isParseResultElement(element)) {
      mediaType = inferOpenApiMediaType(element.api);
      if (element.hasMetaProperty('retrievalURI')) {
        baseURI = element.meta.get('retrievalURI') as string;
      } else if (!baseURI) {
        return { baseURI: undefined, mediaType, refSet, missingBaseURI: 'ParseResultElement' };
      }
    } else if (isParseResultElement(options.dereference?.strategyOpts?.parseResult)) {
      // a child element needs the root document in the refSet for component resolution
      const { parseResult } = options.dereference.strategyOpts;
      let rootURI: string;

      mediaType = inferOpenApiMediaType(parseResult.api);

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

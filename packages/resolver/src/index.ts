export type { ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';

export {
  defaultOptions as defaultDereferenceArazzoOptions,
  dereference as dereferenceArazzo,
  dereferenceElement as dereferenceArazzoElement,
  type Options as DereferenceArazzoOptions,
} from './dereference/arazzo.ts';

export {
  defaultOptions as defaultDereferenceOpenAPIOptions,
  dereference as dereferenceOpenAPI,
  dereferenceElement as dereferenceOpenAPIElement,
  type Options as DereferenceOpenAPIOptions,
} from './dereference/openapi.ts';

export {
  defaultOptions as defaultResolveArazzoOptions,
  resolve as resolveArazzo,
  resolveElement as resolveArazzoElement,
  type Options as ResolveArazzoOptions,
} from './resolve/arazzo.ts';

export {
  defaultOptions as defaultResolveOpenAPIOptions,
  resolve as resolveOpenAPI,
  resolveElement as resolveOpenAPIElement,
  type Options as ResolveOpenAPIOptions,
} from './resolve/openapi.ts';

export {
  defaultOptions as defaultBundleArazzoOptions,
  bundle as bundleArazzo,
  type Options as BundleArazzoOptions,
} from './bundle/arazzo.ts';

export {
  defaultOptions as defaultBundleOpenAPIOptions,
  bundle as bundleOpenAPI,
  type Options as BundleOpenAPIOptions,
} from './bundle/openapi.ts';

export { default as DereferenceError } from './errors/DereferenceError.ts';
export { default as ResolveError } from './errors/ResolveError.ts';
export { default as BundleError } from './errors/BundleError.ts';

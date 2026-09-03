import { mergeOptions as mergeReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import type {
  ApiDOMReferenceOptions,
  Resolver,
} from '@speclynx/apidom-reference/configuration/empty';

const isMemoryResolver = (resolver: Resolver): boolean => resolver.name === 'memory';

/**
 * Merges reference options the same way apidom-reference does, additionally keeping
 * memory resolvers ahead of every other resolver: they serve in-memory documents and
 * must win over any resolver that could read the same URI from disk or network.
 */
export const mergeOptions = (
  target: ApiDOMReferenceOptions,
  source: Record<string, unknown>,
): ApiDOMReferenceOptions => {
  const merged = mergeReferenceOptions(target, source);
  const { resolvers } = merged.resolve;
  const memoryResolvers = resolvers.filter(isMemoryResolver);

  if (memoryResolvers.length === 0) return merged;

  return {
    ...merged,
    resolve: {
      ...merged.resolve,
      resolvers: [...memoryResolvers, ...resolvers.filter((r) => !isMemoryResolver(r))],
    },
  };
};

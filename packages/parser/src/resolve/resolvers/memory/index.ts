import {
  Resolver,
  File,
  ResolverError,
  type ResolverOptions,
  type FileOptions,
} from '@speclynx/apidom-reference/configuration/empty';

export type { Resolver, ResolverOptions };
export type { File, FileOptions };

/**
 * @public
 */
class MemoryResolver extends Resolver {
  declare document?: string;

  declare uri?: string;

  constructor() {
    super({ name: 'memory' });
  }

  canRead(file: File): boolean {
    // only the exact URI this resolver was configured to serve is matched,
    // so a relative source description URL resolved against it (e.g.
    // "memory://arazzo.json/nope.yaml") falls through instead of being
    // served the same in-memory document
    return file.uri === this.uri && this.document !== undefined;
  }

  async read(file: File): Promise<Buffer> {
    try {
      const encoder = new TextEncoder();
      return encoder.encode(this.document) as unknown as Buffer;
    } catch (error: unknown) {
      throw new ResolverError(`Error opening file "${file.uri}"`, { cause: error });
    }
  }
}

export default MemoryResolver;

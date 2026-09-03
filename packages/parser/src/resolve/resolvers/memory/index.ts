import {
  url,
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
export interface MemoryResolverOptions {
  /**
   * Content of the in-memory document.
   */
  readonly document: string;
  /**
   * URI the in-memory document is served under. Relative references
   * within the document resolve against it.
   */
  readonly uri: string;
}

/**
 * Serves an in-memory document under exactly one URI.
 * @public
 */
class MemoryResolver extends Resolver {
  readonly document: string;

  readonly uri: string;

  constructor({ document, uri }: MemoryResolverOptions) {
    super({ name: 'memory' });
    this.document = document;
    // must match the File.uri derivation in apidom-reference's parse()
    this.uri = url.sanitize(url.stripHash(uri));
  }

  canRead(file: File): boolean {
    if (file.uri === this.uri) return true;
    // a foreign memory:// URI can only be a relative URL resolved against a synthetic
    // memory:// base; apidom records the message of an error thrown here verbatim in
    // the source description annotation, whereas an error thrown from read() would be
    // wrapped and its message lost
    if (file.uri.startsWith('memory://')) {
      throw new ResolverError(
        'relative URL cannot be resolved because the parent document was parsed from ' +
          'inline content. Provide resolve.baseURI or an absolute $self.',
      );
    }
    return false;
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

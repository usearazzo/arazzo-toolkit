/**
 * An options bag merged over defaults: every group of `T` optional, and every
 * option in a group optional. An array is kept whole, as the merge replaces
 * it, and so is an option's own value: a class instance or a plain record of
 * free-form options.
 * @public
 */
export type PartialOptions<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly unknown[] ? T[K] : Partial<T[K]>;
};

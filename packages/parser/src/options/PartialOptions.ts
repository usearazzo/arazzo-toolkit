/**
 * An options bag merged over defaults, made optional two levels deep: every
 * field of `T`, and every field of a field whose value is an object (a group
 * of options, such as `resolve` in ApiDOM's reference options). An array is
 * kept whole, as the merge replaces it.
 * @public
 */
export type PartialOptions<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly unknown[] ? T[K] : Partial<T[K]>;
};

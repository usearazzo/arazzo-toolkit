/**
 * An options bag merged over defaults: every group of `T` optional, and every
 * option in a group optional. An option's own value is kept whole, as the
 * merge replaces it: an array, a class instance or a plain record of free-form
 * options.
 * @public
 */
export type PartialOptions<T> = { [K in keyof T]?: Partial<T[K]> };

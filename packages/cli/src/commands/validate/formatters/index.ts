import stylish from './stylish.ts';
import json from './json.ts';
import type { Formatter } from './types.ts';

export type { Formatter, FormatterContext } from './types.ts';

// diagnostic renderers keyed by the `--format` choice. `stylish` is the default;
// `json` is the machine-readable form.
export const formatters: Record<string, Formatter> = {
  stylish,
  json,
};

export const defaultFormat = 'stylish';

export const formatChoices = Object.keys(formatters);

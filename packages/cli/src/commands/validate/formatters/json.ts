import type { Formatter } from './types.ts';

// machine-readable output: the raw diagnostics array as pretty-printed JSON.
// An empty diagnostics set renders as `[]`.
const json: Formatter = (diagnostics) => JSON.stringify(diagnostics, null, 2);

export default json;

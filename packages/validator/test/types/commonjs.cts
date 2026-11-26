// A CommonJS consumer of the published declarations: "typescript:check-published-types"
// type-checks it against the built types/ through the package's require conditions.
import { validateURI } from '@usearazzo/validator';

export const diagnostics = validateURI('workflow.arazzo.yaml', {}, { baseURI: 'https://example.com/' });

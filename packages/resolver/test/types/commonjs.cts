// A CommonJS consumer of the published declarations: "typescript:check-published-types"
// type-checks it against the built types/ through the package's require conditions.
import { dereferenceArazzo, type DereferenceArazzoOptions } from '@usearazzo/resolver';

const options: DereferenceArazzoOptions = { resolve: { baseURI: 'https://example.com/' } };
export const dereferenced = dereferenceArazzo('workflow.arazzo.yaml', options);

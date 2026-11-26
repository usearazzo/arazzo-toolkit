// A CommonJS consumer of the published declarations: "typescript:check-published-types"
// type-checks it against the built types/ through the package's require conditions.
import { parseArazzo, parseRuntimeExpression, type ParseArazzoOptions } from '@usearazzo/parser';

const options: ParseArazzoOptions = { resolve: { baseURI: 'https://example.com/' } };
export const parsed = parseArazzo('workflow.arazzo.yaml', options);
export const expression = parseRuntimeExpression('$statusCode');

import { createRequire } from 'node:module';
import { Command } from 'commander';

import validate from './commands/validate/index.ts';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const program = new Command();

program.name('usearazzo').description('UseArazzo CLI for Arazzo documents').version(version);

program.addCommand(validate);

import { Command, Option, InvalidArgumentError } from 'commander';

import action, { defaultFailSeverity, failSeverityChoices } from './action.ts';
import { defaultFormat, formatChoices } from './formatters/index.ts';

const parseMaxProblems = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer.');
  }
  return parsed;
};

const command = new Command('validate');

command
  .description('Validate and lint an Arazzo document')
  .argument('<uri>', 'path or URL to the Arazzo document (JSON or YAML)')
  .addOption(
    new Option('-f, --format <format>', 'output format for diagnostics')
      .choices(formatChoices)
      .default(defaultFormat),
  )
  .option('--json', 'shorthand for --format json')
  .option('-o, --output <file>', 'write diagnostics to file instead of stdout')
  .option(
    '-c, --config <file>',
    'configuration file (default: first of .usearazzo.{yaml,yml,json} or usearazzo.{yaml,yml,json} in the cwd)',
  )
  .option('--json-schema-validation', 'enable JSON Schema (AJV) validation')
  .option('--max-problems <n>', 'maximum number of problems to report', parseMaxProblems)
  .addOption(
    new Option('--fail-severity <severity>', 'minimum diagnostic severity that fails the run')
      .choices(failSeverityChoices)
      .default(defaultFailSeverity),
  )
  .action(action);

export default command;

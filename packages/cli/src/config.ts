import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { isPlainObject } from 'ramda-adjunct';
import type { LanguageServiceContext } from '@usearazzo/validator';

/**
 * Configuration file names discovered in the current working directory, in
 * priority order. Like Spectral's `.?spectral.(ya?ml|json)`, the leading dot is
 * optional and the file may be YAML or JSON (the YAML parser reads both).
 */
export const CONFIG_FILENAMES = [
  '.usearazzo.yaml',
  '.usearazzo.yml',
  '.usearazzo.json',
  'usearazzo.yaml',
  'usearazzo.yml',
  'usearazzo.json',
] as const;

export interface Config {
  // deep-merged over the validator's defaultLanguageServiceContext
  languageService?: Partial<LanguageServiceContext>;
}

/**
 * Loads the CLI configuration. An explicit `configPath` (relative to the current
 * working directory) must exist; without one, the first of `CONFIG_FILENAMES`
 * present in the current working directory is used, and an empty configuration
 * otherwise. Parent directories are not searched.
 *
 * @throws Error - When the file cannot be read, is not valid YAML or JSON, or has the wrong shape
 */
export const loadConfig = (configPath?: string): Config => {
  const absPath =
    configPath !== undefined
      ? path.resolve(configPath)
      : CONFIG_FILENAMES.map((filename) => path.resolve(filename)).find((candidate) =>
          fs.existsSync(candidate),
        );

  if (absPath === undefined) {
    return {};
  }

  let config: unknown;
  try {
    config = parse(fs.readFileSync(absPath, 'utf-8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to load configuration file ${absPath}: ${message}`, { cause: error });
  }

  // an empty file parses to null and means "no configuration"
  if (config === null || config === undefined) {
    return {};
  }
  if (!isPlainObject(config)) {
    throw new Error(`invalid configuration file ${absPath}: expected a mapping`);
  }
  const { languageService } = config as Record<string, unknown>;
  if (languageService !== undefined && !isPlainObject(languageService)) {
    throw new Error(`invalid configuration file ${absPath}: 'languageService' must be a mapping`);
  }

  return config as Config;
};

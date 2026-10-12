import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const IMAGE = 'swaggerapi/petstore3:1.0.28';
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 1_000;

let containerId: string | undefined;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const docker = async (...args: string[]): Promise<string> => {
  const { stdout } = await exec('docker', args);
  return stdout.trim();
};

const stopContainer = async (): Promise<void> => {
  const id = containerId;
  containerId = undefined;
  if (id === undefined) return;
  try {
    await docker('stop', id);
  } catch {
    // `--rm` removes it once stopped; a container that is already gone is fine.
  }
};

const startContainer = async (): Promise<string> => {
  try {
    await docker('info');
  } catch (error) {
    throw new Error(
      `the e2e suite starts ${IMAGE} with Docker, but Docker is unavailable; start the Docker daemon or set PETSTORE_URL to an existing petstore: ${(error as Error).message}`,
      { cause: error },
    );
  }

  containerId = await docker('run', '--rm', '-d', '-p', '127.0.0.1:0:8080', IMAGE);
  // `docker port` prints one `<address>:<port>` line per binding.
  const [binding] = (await docker('port', containerId, '8080')).split('\n');
  const port = binding.slice(binding.lastIndexOf(':') + 1);

  return `http://127.0.0.1:${port}/api/v3`;
};

const waitUntilReady = async (baseURL: string): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/openapi.json`);
      if (response.status === 200) return;
      lastError = new Error(`GET ${baseURL}/openapi.json answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(READY_POLL_MS);
  }

  throw new Error(
    `petstore at ${baseURL} did not become ready within ${READY_TIMEOUT_MS / 1000}s: ${(lastError as Error).message}`,
  );
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopContainer().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

/**
 * Mocha root hooks: make a petstore available to the e2e specs and publish its
 * base URL as `PETSTORE_URL`. An existing `PETSTORE_URL` is used as is;
 * otherwise the suite starts (and afterwards stops) its own container.
 */
export const mochaHooks = {
  async beforeAll(): Promise<void> {
    try {
      const baseURL = process.env.PETSTORE_URL ?? (await startContainer());
      await waitUntilReady(baseURL);
      process.env.PETSTORE_URL = baseURL;
    } catch (error) {
      await stopContainer();
      throw error;
    }
  },
  async afterAll(): Promise<void> {
    await stopContainer();
  },
};

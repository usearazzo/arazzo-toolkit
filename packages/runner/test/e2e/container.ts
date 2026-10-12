import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// keep in sync with the `petstore` service image in .github/workflows/build.yml and release.yml
const IMAGE = 'swaggerapi/petstore3:1.0.28';
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 1_000;
const READY_REQUEST_TIMEOUT_MS = 5_000;

// named up front so a container started just before an interruption can still be stopped
let containerName: string | undefined;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const docker = async (...args: string[]): Promise<string> => {
  const { stdout } = await exec('docker', args);
  return stdout.trim();
};

const stopContainer = async (): Promise<void> => {
  const name = containerName;
  containerName = undefined;
  if (name === undefined) return;
  try {
    await docker('stop', name);
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

  containerName = `usearazzo-runner-e2e-petstore-${process.pid}`;
  await docker('run', '--rm', '-d', '--name', containerName, '-p', '127.0.0.1:0:8080', IMAGE);
  // `docker port` prints one `<address>:<port>` line per binding.
  const [binding] = (await docker('port', containerName, '8080')).split('\n');
  const port = binding.slice(binding.lastIndexOf(':') + 1);

  return `http://127.0.0.1:${port}/api/v3`;
};

const waitUntilReady = async (baseURL: string): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/openapi.json`, {
        signal: AbortSignal.timeout(READY_REQUEST_TIMEOUT_MS),
      });
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

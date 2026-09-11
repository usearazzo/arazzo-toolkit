## Testing

- Tests use Mocha with Chai assertions. Snapshot testing via `mocha-chai-jest-snapshot`, wired up in each package's `test/mocha-bootstrap.ts` with the ApiDOM and string serializers from `scripts/`.
- Test files live in `packages/*/test/**/*.ts`; `npm test` builds `src` (ES), transpiles `test` to `.mjs` with Babel, then runs Mocha over the `.mjs` files (`.mocharc.json`). Edit the `.ts`, never the emitted `.mjs`.
- Run tests for individual packages: `cd packages/<package-name> && npm test`
- Run a subset: `npm test -- --grep "<describe title>"`. Passing a file path (`--spec` or positional) does NOT narrow the run — Mocha merges it with the `spec` glob in `.mocharc.json`. To run one file after a build: `npx cross-env NODE_ENV=test mocha --no-config --file test/mocha-bootstrap.mjs test/<file>.mjs`
- When output changes intentionally, update snapshots with `UPDATE_SNAPSHOT=1 npm test` (or `npm test -- --update`)
- The runner's tests exercise real HTTP request building through the vendored `swagger-client` bundle, so `build:es` (which regenerates the bundle) must succeed first — `npm test` does this for you.
- **No mocking of the toolkit's own layers.** Tests parse real fixture documents through the real parser and assert on ApiDOM output or snapshots. HTTP in runner tests goes through the `HTTPClient` seam — inject a stub client rather than patching `fetch`.
- **CI**: `.github/workflows/build.yml` runs `lint-commit-messages`, `lint` (after `typescript:declaration` for `parser`), `check-typescript-types` (after `typescript:declaration` for all packages), `test` (after `build:es`), and `build` on every PR. `nightly-build.yml` runs the full `npm run build` + lint + type-check + test daily. No path filters.

### When to run

Run tests when your change could affect behavior covered by a suite. Skip them for pure docs or harness configs (`.claude/`).

- Changed anything in `packages/<pkg>/src/` or `packages/<pkg>/test/` → run that package's tests (`cd packages/<pkg> && npm test`).
- Changed `parser` → also run `resolver`, `validator` and `runner`; they consume `@usearazzo/parser` through the workspace symlink, so a parser change is exercised by their suites too. Same for `resolver` → `runner`.
- Changed `scripts/` (Babel import-extension plugin, Jest serializers), `babel.config.cjs`, `tsconfig.json`, or `eslint.config.js` → run the full suite (`npm test` at the root) and `npm run lint`.
- Changed `packages/*/src/index.ts` exports → also run `npm run typescript:declaration` in that package so `api-extractor` validates the public surface.
- Changed only `README.md`, `CONTRIBUTING.md`, `.claude/`, or `.github/` → no test suites required.

If unsure whether a change is behavior-affecting, run the relevant subset.

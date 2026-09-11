Commit messages MUST follow Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/).

*Enforced via two paths sharing `.commitlintrc.json`: the Claude PreToolUse hook (`.claude/hooks/commitlint-before-commit.mjs`) validates `git commit -m` payloads before Claude fires them, and the husky `commit-msg` hook (`.husky/commit-msg`) validates human / CI commits via `npx commitlint -e`. CI (`lint-commit-messages` job in `.github/workflows/build.yml`) re-validates every commit on a PR.*

Format: `type(scope): description` — max 69 characters in the header.

- Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`, `build`, `ci`, `style`, `revert`
- If a change ships to users, it's `feat` (new capability) or `fix`
  (bug). Internal developer tooling (agent harness configs, editor
  configs, dev scripts, dependency bumps) uses `chore`. The other
  types (`refactor`, `test`, `docs`, `perf`, `build`, `ci`, `style`,
  `revert`) take precedence over `chore` when they fit.
- Scope: always include a scope. Use the primary subject of the change:
  - For code: the package short name without the `@usearazzo/` prefix — `parser`, `resolver`, `validator`, `runner` (e.g. `fix(parser)`, `feat(runner)`)
  - For `docs`: the doc file name without extension (e.g. `docs(README)`, `docs(CONTRIBUTING)`); a change that touches every package README may go scope-less
  - For `ci`: the workflow file name without extension (e.g. `ci(build)`, `ci(release)`, `ci(nightly-build)`). When the change IS the CI config, use type `ci` — not `chore(ci)`.
  - For `chore`: `chore(deps)` / `chore(deps-dev)` for dependency bumps (matches Dependabot), `chore(release)` for release cuts, and `chore(harness)` for anything under `.claude/`
- Description: lowercase, imperative mood, no trailing period
- Fix the message, never bypass the hooks

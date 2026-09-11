## Parallel sessions via worktrees

Arazzo Toolkit is a library monorepo — the build artifacts are npm packages, not a long-running service. So worktree coordination is simple: there are no ports to allocate, no DB files, no compose stacks, and no runnable app.

When the user asks for a worktree:

1. Create it with `EnterWorktree`. Worktree mount points are gitignored under `.claude/worktrees/`; only `.gitkeep` is tracked.
2. Set the Node version: `source ~/.nvm/nvm.sh && nvm use` (the repo's `.nvmrc` pins =26.3.1 — see `nvm.md`).
3. Install deps: `npm install` at the worktree root. npm workspaces hoist into a single root `node_modules/`; husky reinstalls its trampoline on `prepare`. The ~15 Babel peer-dependency ERESOLVE warnings are hoisting noise — ignore them.
4. Build the packages you'll touch: `cd packages/<pkg> && npm run build:es` (ES-only is fastest for development — see `building.md`). Set `CPU_CORES` to your core count for faster parallel builds.

### What's shared vs. isolated

Nothing needs to be copied into a fresh worktree — every artifact a worktree consumes (`node_modules/`, per-package `dist/`/`types/`, emitted `.mjs`/`.cjs`, the runner's `src/vendor/swagger-client.mjs`) is gitignored and regeneratable. The root `.env` (only `CPU_CORES`) and `.mcp.json` are gitignored too; copy them over if you rely on them.

### Tests across worktrees

Tests are Mocha per-package (`cd packages/<pkg> && npm test`) with no shared external state, so concurrent runs across worktrees are safe. Snapshot updates (`UPDATE_SNAPSHOT=1 npm test`) write into the package's own `test/` tree — no cross-worktree collision.

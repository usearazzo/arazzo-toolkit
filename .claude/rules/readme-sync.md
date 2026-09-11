---
paths:
  - "packages/*/src/index.ts"
---

When a change to a package's `src/index.ts` alters its public surface (a new or removed export, a renamed option, a changed default in `default*Options`, a new error class), update that package's `README.md` in the same commit. Each README documents the programmatic API — functions, options tables, error handling — and drifts from the code the same way generated declarations would without `api-extractor`.

If the change adds a whole new capability, also check the package table and any placeholder section in the root `README.md`.

Internal-only edits (re-ordering exports, renaming a private helper, refactoring behind an unchanged signature) do not require a README update.

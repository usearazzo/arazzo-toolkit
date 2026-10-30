---
paths:
  - "packages/runner/**"
  - "packages/cli/**"
  - "packages/validator/**"
---

Every change to `packages/runner`, `packages/cli` or `packages/validator` raises one question before the work is reported done: **does the website need updating?** The canonical docs for these packages live in the `usearazzo/website` repo, cloned at `../website` (next to this repo). The package READMEs here are deliberately short and link there, so a change can leave the README correct and the website wrong.

Answer it with evidence, not from memory:

1. Grep the website for what the change touches: exported names, error classes, options, CLI flags and exit codes, validator rule codes, and behaviour the docs describe in prose (e.g. "throws the parser's own error"). Start with `_reference/<pkg>.md` (`runner.md`, `cli.md`, `validator.md`), then `_guides/`, `_tutorials/`, `llms.txt` and `CONCEPT-CATALOG.md`.
2. Report the answer in the final summary and in the PR body, either as a line: `Website: no change needed (checked _reference/runner.md, …)`, or as the list of pages and lines that need edits, with what each should say.
3. Don't edit the website repo unprompted. Offer to prepare the change on a branch there. The website documents the **published** packages, so its change lands after the npm release that ships the toolkit change, not alongside the PR. Before pushing a website change, regenerate `tailwind.css` (see the website's own `CLAUDE.md`).

Internal-only changes (tests, refactors behind an unchanged public surface and behaviour, build config) still get the question, and the answer is usually a one-line "no change needed", which is enough.

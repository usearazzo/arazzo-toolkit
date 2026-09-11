---
type: constitution
section: mission
generated_by: spec-driven-agent
generated_at: 2026-09-11T22:07:08Z
confidence: high
---

# Mission

Arazzo Toolkit exists because API workflows are still improvised. OpenAPI solved the single call, but the order of calls, the state carried between them, and what "done" means have lived in hand-written scripts, Postman collections, tribal knowledge, and agents winging it at runtime. That glue is rarely reviewed, rarely versioned alongside the API it drives, and breaks quietly when the API changes. The Arazzo Specification fixes the format; the toolkit fixes the tooling.

The existing Arazzo tooling landscape is scattered and shares no engine, so tools disagree on edge cases. Arazzo Toolkit concentrates quality Arazzo tooling in one place, all of it built on one engine (SpecLynx ApiDOM), so that when the validator and the runner disagree about a document, that is a bug, not a difference of opinion. (Framing per `usearazzo/website` `_posts/2026-08-18-api-workflows-are-still-improvised.md`.)

## What We Do

Arazzo Toolkit is a TypeScript monorepo of npm packages for **parsing**, **resolving**, **validating**, and **running** Arazzo documents together with the OpenAPI source descriptions they reference.

We:
- Parse Arazzo and OpenAPI documents from a path, URL, string, or object into ApiDOM, following source descriptions across a network of files, with runtime-expression and criterion-condition grammars exposed alongside (`@usearazzo/parser`).
- Dereference Arazzo and OpenAPI documents so downstream tools work on self-contained trees (`@usearazzo/resolver`).
- Validate and lint Arazzo documents into Language Server Protocol diagnostics, with JSON Schema validation opt-in (`@usearazzo/validator`).
- Execute Arazzo workflows against live HTTP APIs with deterministic control flow (`goto`, `retry`, `end`, sub-workflows, cross-document references, `dependsOn`) over a pluggable HTTP transport (`@usearazzo/runner`).

Three principles govern every package (website, same post): **deterministic execution** (agents get autonomy at the decision boundary, not inside the steps); **the standard is the product** (gaps are fixed upstream in the Arazzo Specification, never with private extensions only our tools can read); **portable artifacts** (plain Arazzo documents in the user's repository, driven from their code, CI, or an agent).

**Supported specifications.** Arazzo 1.0.0, 1.0.1, and 1.1.0 in the parser, resolver, and validator. The runner covers 1.0.x fully and 1.1.0 partially: the remaining 1.1.0 constructs are tracked in issue #119, and AsyncAPI-sourced steps (#122) are deliberately not implemented. OpenAPI 2.0, 3.0.x, and 3.1.x as source descriptions.

## Who We Serve

The audience is two-tier, and the tiers are served by different packages. This split is a settled commitment (per `usearazzo/website` `CONCEPT-CATALOG.md` and `AUDIENCE-NOTES.md`):

- **Tool builders** — people writing code against Arazzo documents: editor plugins, linters, language services, agent integrations, transformers. They consume `parser` and `resolver` as dependencies, not products; neither gets a product page. The parser exists so the next editor plugin or agent integration does not start from a YAML loader.
- **API maintainers** — teams who own an API and want its multi-call flows described once, versioned next to the OpenAPI document, and checked in CI. They use `validator` and, once shipped, `runner` and the CLI.
- **API testers** — people who today write bespoke multi-call test scripts or drive Postman/Newman collections as a de facto workflow engine. The runner replaces that script with a reviewable document.
- **Agent builders** — people building agents on top of APIs who need deterministic, inspectable workflow execution rather than an agent improvising call sequences at runtime.

## Target Audience

- **JavaScript / TypeScript ecosystem** — every package ships ESM, CommonJS, and a UMD browser bundle with rolled-up type declarations; Node.js 20.10+ is the runtime floor and browsers are a first-class target.
- **OpenAPI-native teams** — the lingua franca is OpenAPI, JSON Schema, and Arazzo. Adjacent tools are Postman, Insomnia, OpenAPI editors and linters, and CI runners.
- **The SpecLynx / ApiDOM ecosystem** — documents are ApiDOM trees end to end, so anything that already speaks ApiDOM (language services, editors) composes with the toolkit directly.

## What Success Looks Like

- A tool builder can install `@usearazzo/parser` and get a semantic ApiDOM tree, source positions, and resolved source descriptions for any Arazzo 1.0.x / 1.1.0 document without writing a loader.
- All four packages are published on npm under `@usearazzo` at a stable 1.x, with the validator and runner agreeing on every document they both see.
- An API maintainer can validate an Arazzo document in CI and get LSP-compatible diagnostics that an editor renders identically.
- A runner execution of a workflow is fully determined by the document, its inputs, and the HTTP responses. Given the same three, the run trace is the same.
- Authoring mistakes in a document are reported as typed errors before any live request fires; a step that ran and failed its criteria is a normal result, not an exception.
- Every gap found while building is filed against the Arazzo Specification rather than patched with a vendor extension.

## Decisions

- **Decision:** the runner publishes the moment it runs the official petstore workflow end to end against a live petstore (#79, #106). Nothing else gates publishing: the API surface review (#78), the remaining 1.0.x MUST items, and Arazzo 1.1.0 constructs (#119) all follow as post-publish phases under the alpha channel.
- **Decision:** the runner does not model authentication. Arazzo is auth-agnostic, credentials go through the request interceptor, and this is revisited only if a future Arazzo version defines a security model.
- **Decision:** the ecosystem items on the website roadmap (GitHub Action, MCP server, VS Code extension, language service) are placed per item, in this monorepo or a sibling repository, when each is started. None is built.
- **Decision:** 1.0.0 GA (the first release without a prerelease tag) is gated on four things and nothing else: every package in the monorepo is published (parser, resolver, validator, runner, and the CLI once #84 lands); the official petstore workflows run end to end against a live petstore (the #79 / #106 suite is green at release time); every package has had its public-vs-internal API review and its surface is frozen for 1.x; and `usearazzo/website` carries a complete `_reference` page for every package matching its `src/index.ts`. Arazzo 1.0.x coverage is sufficient; 1.1.0 constructs continue under 1.x minors. No adoption or external signal gates GA.
- **Decision:** the release channel moves alpha → beta → GA. Switching `--preid` to `beta` signals the API freeze; GA follows once every beta package meets the docs criterion above.

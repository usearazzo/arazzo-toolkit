# Phase 8 Retrospective (draft) — Runner Arazzo 1.0.x MUST items

Raw material gathered during implementation, for the human-curated `retrospective.md` once the phase ships.

## Deviations from the spec

- `requirements.md`, Out of Scope, "Version-tagging", and `validation.md`, Not Required: both state that the three rules "read the same in 1.0.0, 1.0.1, and 1.1.0". For #126 that is not accurate. The Arazzo 1.0.0 Parameter Object's `in` description lists `"path"`, `"query"`, `"header"`, `"cookie"`, or `"body"`, while 1.0.1 lists only the first four. The implementation (#283) still rejects `in: body` in every version, which the maintainer decided on 2026-10-27, so the behavior matches the spec. Only the stated rationale was wrong. Reasons for not version-tagging: 1.0.0 contradicts itself (its summary of locations names only four); 1.0.1 is an errata release that resolved this; `requestBody` already exists in 1.0.0 as the way to send a payload, including to an OpenAPI 2.0 body parameter; and the validator rejects `in: body` in 1.0.0 documents too, so accepting it would split the runner from the validator.

## Root cause

The spec's version claim was taken from the issues (#126 says "Arazzo 1.0.1 removed `in: body`") and from the field being unchanged in 1.1.0. Nobody read the 1.0.0 text itself while scaffolding.

## Lesson for future specs

- When a spec states that behavior does not vary by Arazzo version, quote the relevant field from each of the 1.0.0, 1.0.1 and 1.1.0 texts rather than inferring it from an issue. 1.0.1 is an errata release that changed normative lists.

## Promotion candidate

No. This is an empirical reminder for `specs/lessons.md`, not a load-bearing invariant.

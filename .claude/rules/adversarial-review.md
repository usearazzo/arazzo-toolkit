## Adversarial review

Every skill in this repo that reviews its own output — `/sdd-implement-spec`, `/sdd-new-spec`, `/sdd-new-phase`, `/sdd-distill-lessons`, `/review-community` — reviews through the `adversarial-workflow` skill (`.claude/skills/adversarial-workflow/`), never the built-in `/code-review`. The built-in review fans out many agents with no spend control; the adversarial pattern bounds cost through its profile, and every finding is refuted before it counts.

Each calling skill names the **scope** (what is reviewed) and its **dimensions** (one finder each). Everything else follows this contract:

1. **Load the skill.** Invoke `Skill` with `skill: "adversarial-workflow"` and follow it: adapt `skeleton.js`, syntax-check the adapted script, launch with `Workflow`. A calling skill's instruction to run this review is the Workflow opt-in (Gate 0) — do not ask again. The claim-class gate (Gate 1) is pre-judged by the calling skill: its output lands somewhere durable.
2. **Profile `lean` by default.** Use `standard` or `deep` only when the user asks for it in their own words ("thorough", "deep review", `profile: deep`). State the profile and the §6 agent estimate in one line at launch.
3. **Orientation pack** is structure only: the file list in scope, the spec/rule paths each dimension needs, and how to run the relevant checks (`source ~/.nvm/nvm.sh && nvm use`, `cd packages/<pkg> && npm test`). Never put claims or the author's reasoning in it.
4. **Precision-lens vocabulary follows the content.** Code diffs: re-run the command. Markdown (roadmap, lessons, specs): the decisive check is the quote re-check — grep the cited file and line and diff against the quote.
5. **Map the result** into the calling skill's report:
   - survivors by `severity`: `blocking` → **Blockers**, `material` → **Suggestions**, `cosmetic` → **Nits**, `informational` → omitted (give the count only);
   - miss-challenge findings → same buckets, each tagged `(unrefuted)`;
   - `noQuorum` findings → a separate **Unverified** list, never merged into Blockers;
   - `refuted` findings are dropped, but read their `discrepancies` first: a live defect inside a kill is surfaced as a Suggestion tagged `(from refuted finding)`;
   - always print the counts: survived / refuted / no-quorum / unrefuted, plus `agents.failures` if non-empty (a run with failures is degraded — say so).
6. **One run per skill invocation.** Do not re-launch after fix-ups; the calling skill's own verification checks cover fix-ups. Deferred deepen candidates are listed with the survivors, and the follow-up Opus pass runs only if the user asks for it.
7. **On failure** (Workflow tool error, `entailment-lens` preflight abort), surface the error and continue the calling skill as `review skipped — <one-line error>`. Never fall back to `/code-review`, and never substitute a tool-enabled agent for the lens.

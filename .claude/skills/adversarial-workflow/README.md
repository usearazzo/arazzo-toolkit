# adversarial-workflow — a Claude Code skill

A provisioning pattern for Claude Code **Workflow** (multi-agent orchestration) scripts whose output is a claim that matters: audits, code/doc/plan reviews, verification reports, research synthesis. Every finding is attacked by independent refuters on two axes. Model tiers are assigned per role so cost stays bounded, and a failure-hardened skeleton script returns the survivors and run metrics on every path.

`SKILL.md` is the document Claude reads; this README is for the person installing it.

## Contents

| File | Purpose |
|---|---|
| `SKILL.md` | The skill: rules, profiles (lean/standard/deep), budgeting, checklist |
| `skeleton.js` | Annotated Workflow script that Claude adapts per run |
| `agents/entailment-lens.md` | Subagent definition for the lens that has no tools |
| `install.sh` / `install.bat` | Installs the skill and the agent, checks status, uninstalls (macOS/Linux / Windows) |
| `report-agents.py` | Post-run per-agent cost table (Python stdlib only) |
| `EVIDENCE.md` | Measurements and revision history behind the rules (maintainers) |

## Requirements

- Claude Code with the **Workflow** tool available
- `bash` (macOS/Linux) or `cmd` (Windows) for the installer, plus `node` (syntax check of the adapted script) and `python3` (cost report)
- Access to the `sonnet` and `opus` model tiers

## Install

Unpack anywhere, then run the installer from inside the folder:

```bash
bash adversarial-workflow/install.sh                    # for you: ~/.claude/skills + ~/.claude/agents
bash adversarial-workflow/install.sh --project ~/my-repo # for one repo: <repo>/.claude/...
```

On Windows, from Command Prompt (or double-click `install.bat` for a user install):

```bat
adversarial-workflow\install.bat
adversarial-workflow\install.bat --project C:\path\to\my-repo
```

From PowerShell, prefix with `cmd /c`. Under Git Bash or WSL, `install.sh` works too, but note that WSL's `~` is the Linux home, not the Windows one Claude Code for Windows reads.

Then **restart Claude Code**. Claude Code reads agent definitions only at session start, so the `entailment-lens` agent type doesn't resolve in a session that was already open when you installed it.

Check the install at any time (exit code 0 means ready):

```bash
bash ~/.claude/skills/adversarial-workflow/install.sh --check
```

```bat
%USERPROFILE%\.claude\skills\adversarial-workflow\install.bat --check
```

### Why there is an installer

The skill runs one of its reviewers as `agentType: 'entailment-lens'`, a subagent whose definition allows no evidence-gathering tools. Claude Code resolves agent types from `.claude/agents/`, not from a skill folder, so the bundled definition has to be copied there. If it's missing, the skeleton's preflight stops the workflow before any paid stage instead of running with that reviewer silently absent. If Claude finds the agent missing, the skill tells it to run the installer and ask you to restart.

### Updating or removing

- Re-running the installer is idempotent. If your installed `entailment-lens.md` differs from the bundled one, the installer shows the diff and stops. Pass `--force` to replace it, then restart.
- `--uninstall` (add `--project DIR` for a repo install) removes the skill and the agent.

## Use

Ask for something like "use a workflow to adversarially review this PR, standard profile". Workflows are opt-in, so the skill only launches one when you ask for multi-agent orchestration. Otherwise Claude describes the run and its estimated cost, and asks first. Profiles: `lean` (cheapest), `standard` (default), `deep` (inline Opus diagnosis of survivors).

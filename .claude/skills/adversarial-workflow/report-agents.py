#!/usr/bin/env python3
"""Per-agent cost table for an adversarial-workflow run (SKILL.md §8).

Usage: python3 report-agents.py <task-output-file>

<task-output-file> is the <output-file> path from the workflow's completion
notification. Its `workflowProgress` array carries one entry per agent with
label, phase, RESOLVED model id, tokens, tool calls, and duration — this is
the authoritative source for the resolved model IDs §8 requires (the run
journal does not record them). Stdlib only; no dependencies.
"""
import json
import sys


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    with open(sys.argv[1]) as f:
        out = json.load(f)

    agents = [e for e in out.get("workflowProgress", []) if e.get("type") == "workflow_agent"]
    if not agents:
        print("no workflow_agent entries in workflowProgress — wrong file, or a run that predates progress capture", file=sys.stderr)
        return 1
    agents.sort(key=lambda a: a.get("startedAt", 0))

    wl = max(len(a.get("label", "?")) for a in agents) + 2
    print(f"{'label':{wl}}{'phase':9}{'model':20}{'tokens':>9}{'tools':>6}{'secs':>8}  state")
    for a in agents:
        print(
            f"{a.get('label', '?'):{wl}}{a.get('phaseTitle', '?'):9}{a.get('model', '?'):20}"
            f"{a.get('tokens', 0):>9}{a.get('toolCalls', 0):>6}{a.get('durationMs', 0) / 1000:>8.1f}"
            f"  {a.get('state', '?')}"
        )

    total = sum(a.get("tokens", 0) for a in agents)
    not_done = [a["label"] for a in agents if a.get("state") != "done"]
    print(f"\nTOTAL: {len(agents)} agents, {total} tokens", end="")
    if not_done:
        # A clean table with non-done rows is a degraded run, not a clean one (§8).
        print(f" — {len(not_done)} NOT done: {', '.join(not_done)}", end="")
    print("\n\nper-model rollup (resolved IDs — record these with the run report):")
    by_model = {}
    for a in agents:
        m = by_model.setdefault(a.get("model", "?"), [0, 0])
        m[0] += 1
        m[1] += a.get("tokens", 0)
    for model, (n, tok) in sorted(by_model.items(), key=lambda kv: -kv[1][1]):
        print(f"  {model:20} {n:>3} agents {tok:>9} tokens ({tok * 100 // max(total, 1)}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

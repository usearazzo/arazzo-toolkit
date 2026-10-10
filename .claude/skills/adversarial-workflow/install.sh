#!/usr/bin/env bash
# Installer for the adversarial-workflow skill and its bundled entailment-lens agent.
#
# Claude Code resolves `agentType: 'entailment-lens'` from its agent registry
# (.claude/agents/), never from a skill directory, and it reads agent definitions
# only at session start. So this script places both halves, and a restart is
# required after the agent file is first installed or changed.
#
# Usage:
#   install.sh                 install for the current user (~/.claude)
#   install.sh --project DIR   install into DIR/.claude (shared with that repo)
#   install.sh --check         report status only; exit 0 = ready, 1 = action needed
#   install.sh --force         overwrite an entailment-lens.md that differs
#   install.sh --uninstall     remove the skill and the agent from the chosen scope
#
# Flags combine: `install.sh --project . --check`. Bash 3.2 compatible (macOS).
set -euo pipefail

SKILL_NAME="adversarial-workflow"
AGENT_NAME="entailment-lens"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AGENT_SRC="$SRC/agents/$AGENT_NAME.md"

ROOT="$HOME/.claude"
MODE="install"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || { echo "--project needs a directory" >&2; exit 2; }
      ROOT="$(cd "$2" && pwd -P)/.claude"; shift 2 ;;
    --check)     MODE="check"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --force)     FORCE=1; shift ;;
    -h|--help)   sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

SKILL_DST="$ROOT/skills/$SKILL_NAME"
AGENT_DST="$ROOT/agents/$AGENT_NAME.md"
[ -f "$AGENT_SRC" ] || { echo "bundled agent missing: $AGENT_SRC" >&2; exit 2; }

# The skill counts as installed when this script already runs from inside the
# target scope, or when the target holds a copy.
skill_in_place() {
  [ -d "$SKILL_DST" ] && [ "$(cd "$SKILL_DST" && pwd -P)" = "$SRC" ]
}

case "$MODE" in
  check)
    rc=0
    if skill_in_place || [ -f "$SKILL_DST/SKILL.md" ]; then
      echo "skill:  ok      $SKILL_DST"
    else
      echo "skill:  MISSING $SKILL_DST"; rc=1
    fi
    if [ ! -f "$AGENT_DST" ]; then
      echo "agent:  MISSING $AGENT_DST"; rc=1
    elif cmp -s "$AGENT_SRC" "$AGENT_DST"; then
      echo "agent:  ok      $AGENT_DST"
    else
      echo "agent:  DIFFERS $AGENT_DST (from the bundled copy; reinstall with --force)"; rc=1
    fi
    [ $rc -eq 0 ] && echo "Ready. If you installed or changed the agent during this session, restart Claude Code first."
    exit $rc ;;

  uninstall)
    if skill_in_place; then
      echo "not removing $SKILL_DST: this script runs from it (delete the folder yourself)"
    elif [ -d "$SKILL_DST" ]; then
      rm -rf "$SKILL_DST"; echo "removed $SKILL_DST"
    fi
    if [ -f "$AGENT_DST" ]; then rm -f "$AGENT_DST"; echo "removed $AGENT_DST"; fi
    exit 0 ;;
esac

# --- install ---------------------------------------------------------------
mkdir -p "$ROOT/skills" "$ROOT/agents"

if skill_in_place; then
  echo "skill:  already in place at $SKILL_DST"
elif [ -d "$SKILL_DST" ] && diff -rq -x '.DS_Store' -x '__MACOSX' "$SRC" "$SKILL_DST" >/dev/null 2>&1; then
  echo "skill:  already current at $SKILL_DST"
else
  if [ -e "$SKILL_DST" ] && [ $FORCE -eq 0 ]; then
    echo "skill:  $SKILL_DST exists and differs from this copy:" >&2
    diff -rq -x '.DS_Store' -x '__MACOSX' "$SKILL_DST" "$SRC" >&2 || true
    echo "        rerun with --force to replace it (e.g. to upgrade)" >&2
    exit 1
  fi
  rm -rf "$SKILL_DST"
  mkdir -p "$SKILL_DST"
  # Copy contents, not the folder, so a renamed download still lands as $SKILL_NAME.
  (cd "$SRC" && tar cf - --exclude '.DS_Store' --exclude '__MACOSX' .) | (cd "$SKILL_DST" && tar xf -)
  chmod +x "$SKILL_DST/install.sh"
  echo "skill:  installed to $SKILL_DST"
fi

changed=0
if [ -f "$AGENT_DST" ] && cmp -s "$AGENT_SRC" "$AGENT_DST"; then
  echo "agent:  already current at $AGENT_DST"
elif [ -f "$AGENT_DST" ] && [ $FORCE -eq 0 ]; then
  echo "agent:  $AGENT_DST exists and differs from the bundled copy:" >&2
  diff -u "$AGENT_DST" "$AGENT_SRC" >&2 || true
  echo "        rerun with --force to replace it" >&2
  exit 1
else
  cp "$AGENT_SRC" "$AGENT_DST"; changed=1
  echo "agent:  installed to $AGENT_DST"
fi

if [ $changed -eq 1 ]; then
  echo
  echo "RESTART Claude Code before the first workflow run: agent definitions load only"
  echo "at session start, so '$AGENT_NAME' does not resolve in sessions already open."
fi

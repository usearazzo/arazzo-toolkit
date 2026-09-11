#!/bin/bash

COMMAND=$(jq -r '.tool_input.command' < /dev/stdin)

if ! echo "$COMMAND" | grep -q '^git commit'; then
  exit 0
fi

source ~/.nvm/nvm.sh && nvm use > /dev/null 2>&1

echo "Running TypeScript type check before commit..." >&2

CHANGED_PACKAGES=$(git diff --cached --name-only | grep '^packages/' | cut -d/ -f1-2 | sort -u)

for pkg in $CHANGED_PACKAGES; do
  if [ -f "$pkg/package.json" ] && grep -q '"typescript:check-types"' "$pkg/package.json"; then
    echo "Type-checking $pkg..." >&2
    if ! (cd "$pkg" && npm run typescript:check-types 2>&1); then
      echo "" >&2
      echo "TypeScript check failed in $pkg" >&2
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "TypeScript type check failed. Fix type errors before committing."
        }
      }'
      exit 0
    fi
  fi
done

exit 0
#!/bin/bash

COMMAND=$(jq -r '.tool_input.command' < /dev/stdin)

if ! echo "$COMMAND" | grep -q '^git commit'; then
  exit 0
fi

source ~/.nvm/nvm.sh && nvm use > /dev/null 2>&1

echo "Building TypeScript declarations before commit..." >&2

CHANGED_PACKAGES=$(git diff --cached --name-only | grep '^packages/' | cut -d/ -f1-2 | sort -u)

for pkg in $CHANGED_PACKAGES; do
  if [ -f "$pkg/package.json" ] && grep -q '"typescript:declaration"' "$pkg/package.json"; then
    echo "Building declarations for $pkg..." >&2
    if ! (cd "$pkg" && npm run typescript:declaration 2>&1); then
      echo "" >&2
      echo "TypeScript declaration build failed in $pkg" >&2
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "TypeScript declaration build failed. Fix errors before committing."
        }
      }'
      exit 0
    fi
  fi
done

exit 0
#!/usr/bin/env node
// PreToolUse hook: validate Conventional Commits before Claude fires `git commit`.
// Reads Claude Code's tool-input JSON from stdin. On a malformed message, emits
// a `permissionDecision: deny` JSON so the bash command never runs.
// Mirrors what .husky/commit-msg enforces for human/CI commits.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMITLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'commitlint');

const emitDeny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
};

// Strip one level of leading whitespace from every line, like Python's textwrap.dedent —
// used for the `<<-` heredoc form, which lets the body be indented.
const dedent = (text) => {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^[ \t]*/)[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(common)).join('\n');
};

const extractMessage = (command) => {
  // The flag is matched as `-[a-z]*m` so glued short-flag clusters (`-am`, `-sm`)
  // are handled the same as a bare `-m` — Claude Code emits `-am` routinely.
  // Pattern: -m "$(cat <<'DELIM' ... DELIM)" — the HEREDOC form Claude Code emits for
  // multi-line commit messages (so commit-message formatting survives shell quoting).
  // Terminator anchored to start of line (multiline); `<<-` form allows leading tabs/spaces.
  let m = command.match(
    /-[a-z]*m\s+"?\$\(\s*cat\s+<<(-?)\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n[\t ]*\2\s*$/m,
  );
  if (m) {
    return m[1] === '-' ? dedent(m[3]) : m[3];
  }
  // Pattern: -m "..." — bash double-quotes only escape \$ \" \\ \` (NOT \n, \t, \uNNNN).
  m = command.match(/-[a-z]*m\s+"((?:[^"\\]|\\.)*)"/);
  if (m) {
    const body = m[1].replace(/\\([$"\\`])/g, '$1');
    // Fail open: a `$(...)` body means the heredoc pattern above missed an
    // exotic delimiter and we captured the literal command substitution, not
    // the message. Defer to husky rather than deny on garbage.
    return body.startsWith('$(') ? null : body;
  }
  // Pattern: -m '...' (single quotes — no escapes in shell)
  m = command.match(/-[a-z]*m\s+'([^']*)'/);
  if (m) {
    return m[1];
  }
  return null;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    return 0;
  }

  const command = data?.tool_input?.command || '';

  // Match `git commit` allowing flags between (e.g., `git -C /path commit`, `git -c k=v commit`).
  if (!/(^|[\s&;|])git(\s+\S+)*?\s+commit(\s|$)/.test(command)) {
    return 0;
  }
  // Check for `--no-edit` only in the args before -m / --message — avoid false-matching
  // the literal string inside a message body.
  const argsPrefix = command.split(/\s-[a-z]*m\b|\s--message\b/)[0];
  if (argsPrefix.includes('--no-edit')) {
    return 0;
  }
  if (!existsSync(COMMITLINT_BIN)) {
    // Fresh checkout before `npm install` — defer to husky.
    return 0;
  }

  const msg = extractMessage(command);
  if (!msg) {
    // Couldn't extract (e.g., -F file or interactive editor); husky covers it.
    return 0;
  }

  const proc = spawnSync(COMMITLINT_BIN, {
    input: msg,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30_000,
  });
  if (proc.error || proc.status === null) {
    // commitlint missing or timed out; defer to husky.
    return 0;
  }
  if (proc.status === 0) {
    return 0;
  }

  const output = `${proc.stdout}${proc.stderr}`.trim() || 'commitlint reported errors.';
  emitDeny(
    'Commit message fails Conventional Commits validation ' +
      '(see .claude/rules/conventional-commits.md):\n\n' +
      output,
  );
  return 0;
};

main().then((code) => process.exit(code));

#!/usr/bin/env bash
# beforeShellExecution: block merge, force-push, --no-verify, and obvious secrets.
# Exit 2 blocks the action. https://cursor.com/docs/agent/hooks
set -u

input=$(cat)
command=$(printf '%s' "$input" | node --input-type=module -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(raw);
    process.stdout.write(typeof parsed.command === "string" ? parsed.command : "");
  } catch {
    process.stdout.write("");
  }
});
')

deny() {
  reason=$1
  printf '%s\n' "{\"permission\":\"deny\",\"user_message\":\"${reason}\",\"agent_message\":\"${reason}\"}"
  exit 2
}

allow() {
  printf '%s\n' '{"permission":"allow"}'
  exit 0
}

if [ -z "$command" ]; then
  deny "blocked: shell hook could not read the command"
fi

if printf '%s' "$command" | grep -Eq '(^|[[:space:];&|])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
  deny "blocked: gh pr merge is not allowed"
fi

if printf '%s' "$command" | grep -Eq '(^|[[:space:];&|])git[[:space:]]+push([[:space:]]|$)'; then
  if printf '%s' "$command" | grep -Eq '(^|[[:space:]])(--force|--force-with-lease|-f)([[:space:]]|$)'; then
    deny "blocked: git push --force is not allowed"
  fi
fi

if printf '%s' "$command" | grep -Eq '(^|[[:space:]])--no-verify([[:space:]]|$)'; then
  deny "blocked: --no-verify is not allowed"
fi

# Env var names are allowed. A token-shaped value on the command line is not.
if printf '%s' "$command" | grep -Eq 'xai-[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}'; then
  deny "blocked: command contains an obvious secret pattern"
fi

allow

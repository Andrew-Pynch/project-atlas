# project-atlas soft startup hooks for codex and claude

: "${ATLAS_ROOT:=$HOME/personal/project-atlas}"
: "${ATLAS_PERSONAL_ROOT:=$HOME/personal}"
: "${ATLAS_API_BASE:=http://localhost:3341}"

atlas__should_hook() {
  [[ "${ATLAS_HOOK_BYPASS:-0}" != "1" ]] && [[ "$PWD" == "${ATLAS_PERSONAL_ROOT}"* ]]
}

atlas__startup_brief() {
  local agent="$1"
  shift || true

  if atlas__should_hook && command -v bun >/dev/null 2>&1; then
    local command_line="$agent $*"
    ATLAS_API_BASE="$ATLAS_API_BASE" bun "$ATLAS_ROOT/apps/api/src/startup-brief.ts" "$PWD" "$agent" "$command_line" >/dev/stderr 2>/dev/null || true
  fi
}

codex() {
  if [[ "${1:-}" == "--no-atlas-hook" ]]; then
    shift || true
    command codex "$@"
    return $?
  fi
  atlas__startup_brief codex "$@"
  command codex "$@"
}

claude() {
  if [[ "${1:-}" == "--no-atlas-hook" ]]; then
    shift || true
    command claude "$@"
    return $?
  fi
  atlas__startup_brief claude "$@"
  command claude "$@"
}

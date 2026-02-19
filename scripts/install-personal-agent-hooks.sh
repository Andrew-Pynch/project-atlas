#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_FILE="$ROOT_DIR/scripts/atlas-shell-hooks.zsh"
ZSHRC="$HOME/.zshrc"
MARKER_START="# >>> project-atlas hooks >>>"
MARKER_END="# <<< project-atlas hooks <<<"

if [[ ! -f "$HOOK_FILE" ]]; then
  echo "Hook file not found: $HOOK_FILE"
  exit 1
fi

if [[ ! -f "$ZSHRC" ]]; then
  touch "$ZSHRC"
fi

if grep -q "$MARKER_START" "$ZSHRC"; then
  echo "project-atlas hook block already exists in ~/.zshrc"
else
  cat >> "$ZSHRC" <<BLOCK

$MARKER_START
export ATLAS_ROOT="$ROOT_DIR"
export ATLAS_PERSONAL_ROOT="\$HOME/personal"
export ATLAS_API_BASE="http://localhost:3341"
[[ -f "\$ATLAS_ROOT/scripts/atlas-shell-hooks.zsh" ]] && source "\$ATLAS_ROOT/scripts/atlas-shell-hooks.zsh"
$MARKER_END
BLOCK
  echo "Installed project-atlas hook block into ~/.zshrc"
fi

echo "Reload shell: source ~/.zshrc"
echo "Bypass once: codex --no-atlas-hook ...  or  claude --no-atlas-hook ..."

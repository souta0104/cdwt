#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
BIN_DIR=${HOME}/.local/bin
SHARE_DIR=${HOME}/.local/share/cdwt
ZSHRC=${HOME}/.zshrc
RC_LINE='source "$HOME/.local/share/cdwt/cdwt.zsh"'
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

mkdir -p "$BIN_DIR" "$SHARE_DIR"
install -m 0755 "$REPO_ROOT/bin/cdwt-select" "$BIN_DIR/cdwt-select"
install -m 0644 "$REPO_ROOT/shell/cdwt.zsh" "$SHARE_DIR/cdwt.zsh"

if [[ ! -f "$ZSHRC" ]]; then
  touch "$ZSHRC"
fi

if ! grep -Fqx "$RC_LINE" "$ZSHRC"; then
  {
    printf '\n'
    printf '%s\n' "$RC_LINE"
  } >> "$ZSHRC"
fi

if ! grep -Fqx "$PATH_LINE" "$ZSHRC"; then
  {
    printf '%s\n' "$PATH_LINE"
  } >> "$ZSHRC"
fi

cat <<EOF
Installed cdwt.

Persistent setup was added to:
  - $ZSHRC

What remains:
  - reload your current shell with: exec zsh -l
    or: source "$ZSHRC"
  - then run: cdwt
EOF

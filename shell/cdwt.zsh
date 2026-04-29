cdwt() {
  local destination

  if ! destination="$("$HOME/.local/bin/cdwt-select" "$@")"; then
    return $?
  fi

  if [[ -z "$destination" ]]; then
    return 1
  fi

  cd "$destination" || return $?
}

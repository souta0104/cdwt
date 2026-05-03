cdwt() {
  local destination

  case "${1-}" in
    -h|--help)
      "$HOME/.local/bin/cdwt-select" "$@"
      return $?
      ;;
  esac

  if ! destination="$("$HOME/.local/bin/cdwt-select" "$@")"; then
    return $?
  fi

  if [[ -z "$destination" ]]; then
    return 1
  fi

  cd "$destination" || return $?
}

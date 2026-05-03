cdwt() {
  local destination

  case "${1-}" in
    -h|--help)
      cdwt-select "$@"
      return $?
      ;;
  esac

  if ! destination="$(cdwt-select "$@")"; then
    return $?
  fi

  if [[ -z "$destination" ]]; then
    return 1
  fi

  cd "$destination" || return $?
}

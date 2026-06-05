cdwt() {
  local destination

  case "${1-}" in
    -h|--help)
      command cdwt "$@"
      return $?
      ;;
  esac

  if ! destination="$(command cdwt "$@")"; then
    return $?
  fi

  if [[ -z "$destination" ]]; then
    return 1
  fi

  cd "$destination" || return $?
}

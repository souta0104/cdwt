cdwt() {
  local destination

  case "${1-}" in
    -h|--help)
      command cdwt "$@"
      return $?
      ;;
  esac

  if ! destination="$(CDWT_SHELL_WRAPPER=1 command cdwt "$@")"; then
    return $?
  fi

  if [[ -z "$destination" ]]; then
    return 1
  fi

  cd "$destination" || return $?
}

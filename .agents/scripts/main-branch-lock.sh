#!/usr/bin/env sh
set -eu

usage() {
  cat <<'USAGE'
Usage:
  .agents/scripts/main-branch-lock.sh run [options] -- <command> [args...]
  .agents/scripts/main-branch-lock.sh status

Serializes local main-branch write windows across repo task worktrees.

Options for run:
  --owner <name>             Human-readable plan, branch, or task name.
  --timeout-seconds <n>      Seconds to wait for the lock. Defaults to 3600.
  --retry-seconds <n>        Seconds between lock attempts. Defaults to 60.
  -h, --help                 Show this help.

Environment defaults:
  MAIN_BRANCH_LOCK_TIMEOUT_SECONDS
  MAIN_BRANCH_LOCK_RETRY_SECONDS
USAGE
}

die() {
  printf '%s\n' "error: $*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

is_positive_integer() {
  case "$1" in
    ""|*[!0-9]*) return 1 ;;
    *) [ "$1" -gt 0 ] ;;
  esac
}

read_kv_field() {
  field="$1"
  file="$2"
  [ -f "$file" ] || return 0
  awk -F= -v field="$field" '$1 == field { print substr($0, index($0, "=") + 1); exit }' "$file"
}

pid_is_alive() {
  pid="$1"
  is_positive_integer "$pid" || return 1
  kill -0 "$pid" 2>/dev/null
}

resolve_roots() {
  checkout_root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git checkout"
  case "$checkout_root" in
    */.agents/worktrees/*)
      main_root="${checkout_root%%/.agents/worktrees/*}"
      ;;
    *)
      main_root="$checkout_root"
      ;;
  esac

  [ -d "$main_root/.agents" ] || die "main root does not have .agents: $main_root"
  lock_dir="$main_root/.agents/locks/main-branch.lock"
  lock_info="$lock_dir/info"
}

print_lock_info() {
  if [ -f "$lock_info" ]; then
    sed -n '1,120p' "$lock_info"
  else
    log "locked=true"
    log "path=$lock_dir"
    log "info=unavailable"
  fi
}

status_lock() {
  resolve_roots
  if [ -d "$lock_dir" ]; then
    print_lock_info
  else
    log "locked=false"
    log "path=$lock_dir"
  fi
}

active_lock=""

release_lock() {
  if [ -n "$active_lock" ] && [ -d "$active_lock" ]; then
    rm -f "$active_lock/info"
    rmdir "$active_lock" 2>/dev/null || true
    active_lock=""
  fi
}

write_lock_info() {
  owner="$1"
  command_text="$2"
  host="$(hostname 2>/dev/null || printf unknown)"
  user_name="${USER:-unknown}"
  branch="$(git -C "$checkout_root" rev-parse --abbrev-ref HEAD 2>/dev/null || printf unknown)"
  commit="$(git -C "$checkout_root" rev-parse --short HEAD 2>/dev/null || printf unknown)"
  {
    printf 'locked=true\n'
    printf 'pid=%s\n' "$$"
    printf 'host=%s\n' "$host"
    printf 'user=%s\n' "$user_name"
    printf 'owner=%s\n' "$owner"
    printf 'checkout_root=%s\n' "$checkout_root"
    printf 'main_root=%s\n' "$main_root"
    printf 'branch=%s\n' "$branch"
    printf 'commit=%s\n' "$commit"
    printf 'started=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'command=%s\n' "$command_text"
  } >"$lock_info"
}

prepare_lock_parent() {
  parent="$(dirname "$lock_dir")"
  if ! mkdir -p "$parent" 2>/dev/null; then
    die "could not create main-branch lock parent directory: $parent"
  fi
}

acquire_lock() {
  owner="$1"
  timeout_seconds="$2"
  retry_seconds="$3"
  command_text="$4"
  host="$(hostname 2>/dev/null || printf unknown)"

  prepare_lock_parent
  waited=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [ ! -d "$lock_dir" ]; then
      die "could not create main-branch lock directory: $lock_dir (check filesystem permissions or sandbox access)"
    fi

    lock_pid="$(read_kv_field pid "$lock_info")"
    lock_host="$(read_kv_field host "$lock_info")"
    if [ "$lock_host" = "$host" ] && [ -n "$lock_pid" ] && ! pid_is_alive "$lock_pid"; then
      log "removing stale main-branch lock: $lock_dir (pid $lock_pid)"
      rm -f "$lock_info"
      rmdir "$lock_dir" 2>/dev/null || true
      continue
    fi

    lock_owner="$(read_kv_field owner "$lock_info")"
    lock_started="$(read_kv_field started "$lock_info")"
    lock_branch="$(read_kv_field branch "$lock_info")"
    if [ "$waited" -ge "$timeout_seconds" ]; then
      {
        printf '%s\n' "error: timed out waiting for main-branch lock: $lock_dir"
        printf '%s\n' "current lock: owner=${lock_owner:-unknown} host=${lock_host:-unknown} pid=${lock_pid:-unknown} branch=${lock_branch:-unknown} started=${lock_started:-unknown}"
      } >&2
      exit 1
    fi

    log "waiting for main-branch lock: owner=${lock_owner:-unknown} host=${lock_host:-unknown} pid=${lock_pid:-unknown} branch=${lock_branch:-unknown} started=${lock_started:-unknown}"
    sleep "$retry_seconds"
    waited=$((waited + retry_seconds))
  done

  active_lock="$lock_dir"
  write_lock_info "$owner" "$command_text"
  log "acquired main-branch lock: $lock_dir"
}

run_with_lock() {
  owner=""
  timeout_seconds="${MAIN_BRANCH_LOCK_TIMEOUT_SECONDS:-3600}"
  retry_seconds="${MAIN_BRANCH_LOCK_RETRY_SECONDS:-60}"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --owner)
        [ "$#" -ge 2 ] || die "--owner requires a value"
        owner="$2"
        shift 2
        ;;
      --timeout-seconds)
        [ "$#" -ge 2 ] || die "--timeout-seconds requires a value"
        timeout_seconds="$2"
        shift 2
        ;;
      --retry-seconds)
        [ "$#" -ge 2 ] || die "--retry-seconds requires a value"
        retry_seconds="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      *)
        die "unknown run option: $1"
        ;;
    esac
  done

  [ "$#" -gt 0 ] || die "run requires a command after --"
  is_positive_integer "$timeout_seconds" || die "--timeout-seconds must be a positive integer"
  is_positive_integer "$retry_seconds" || die "--retry-seconds must be a positive integer"
  if [ -z "$owner" ]; then
    owner="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf unknown)"
  fi

  resolve_roots
  command_text="$*"
  trap release_lock EXIT HUP INT TERM
  acquire_lock "$owner" "$timeout_seconds" "$retry_seconds" "$command_text"

  if "$@"; then
    command_status=0
  else
    command_status=$?
  fi
  release_lock
  trap - EXIT HUP INT TERM
  exit "$command_status"
}

mode="${1:-}"
case "$mode" in
  run)
    shift
    run_with_lock "$@"
    ;;
  status)
    shift
    [ "$#" -eq 0 ] || die "status does not take arguments"
    status_lock
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    die "unknown command: $mode"
    ;;
esac

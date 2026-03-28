#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P
)"

TARGET_DIR="$SCRIPT_DIR"
DRY_RUN=0
CHANGELOG=""
TAGS="${TAGS:-latest}"
FAMILY="${FAMILY:-code-plugin}"
NAME="${NAME:-}"
DISPLAY_NAME="${DISPLAY_NAME:-}"
VERSION="${VERSION:-}"
SOURCE_REPO="${SOURCE_REPO:-}"
SOURCE_COMMIT="${SOURCE_COMMIT:-}"
SOURCE_REF="${SOURCE_REF:-}"
SOURCE_PATH="${SOURCE_PATH:-}"

usage() {
  cat <<'EOF'
Usage: ./publish.sh [options] [path]

Publish the current OpenClaw package to ClawHub.

Options:
  --changelog TEXT   Changelog text passed to clawhub
  --tags TAGS        Comma-separated tags (default: latest)
  --family FAMILY    code-plugin|bundle-plugin (default: code-plugin)
  --name NAME        Override package name
  --display-name NAME
                     Override display name
  --version VERSION  Override version
  --source-repo REPO Override source repo, for example owner/repo
  --source-commit SHA
                     Override source commit SHA
  --source-ref REF   Optional source ref/tag/branch
  --source-path PATH Optional source path inside the repo
  --dry-run          Print the resolved clawhub command without publishing
  -h, --help         Show this help

Environment overrides:
  NAME, DISPLAY_NAME, VERSION, TAGS, FAMILY
  SOURCE_REPO, SOURCE_COMMIT, SOURCE_REF, SOURCE_PATH

Notes:
  source fields are auto-detected from local .git metadata when possible.
  The script does not invoke the git command.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changelog)
      CHANGELOG="${2-}"
      shift 2
      ;;
    --tags)
      TAGS="${2-}"
      shift 2
      ;;
    --family)
      FAMILY="${2-}"
      shift 2
      ;;
    --name)
      NAME="${2-}"
      shift 2
      ;;
    --display-name)
      DISPLAY_NAME="${2-}"
      shift 2
      ;;
    --version)
      VERSION="${2-}"
      shift 2
      ;;
    --source-repo)
      SOURCE_REPO="${2-}"
      shift 2
      ;;
    --source-commit)
      SOURCE_COMMIT="${2-}"
      shift 2
      ;;
    --source-ref)
      SOURCE_REF="${2-}"
      shift 2
      ;;
    --source-path)
      SOURCE_PATH="${2-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

TARGET_DIR="$(
  cd "$TARGET_DIR" && pwd -P
)"

if ! command -v clawhub >/dev/null 2>&1; then
  echo "clawhub is not installed or not in PATH" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read package metadata" >&2
  exit 1
fi

PACKAGE_JSON="$TARGET_DIR/package.json"
PLUGIN_JSON="$TARGET_DIR/openclaw.plugin.json"

if [[ ! -f "$PACKAGE_JSON" ]]; then
  echo "Missing package.json in $TARGET_DIR" >&2
  exit 1
fi

if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo "Missing openclaw.plugin.json in $TARGET_DIR" >&2
  exit 1
fi

json_field() {
  local file="$1"
  local field="$2"
  node -p "const data = require(process.argv[1]); const value = data['$field']; value == null ? '' : String(value)" "$file"
}

find_repo_root() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -e "$dir/.git" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

resolve_git_dir() {
  local repo_root="$1"
  local git_entry="$repo_root/.git"
  local git_dir

  if [[ -d "$git_entry" ]]; then
    printf '%s\n' "$git_entry"
    return 0
  fi

  if [[ -f "$git_entry" ]]; then
    git_dir="$(sed -n 's/^gitdir: //p' "$git_entry" | head -n 1)"
    if [[ -z "$git_dir" ]]; then
      return 1
    fi
    if [[ "$git_dir" != /* ]]; then
      git_dir="$repo_root/$git_dir"
    fi
    printf '%s\n' "$git_dir"
    return 0
  fi

  return 1
}

normalize_repo() {
  local remote="$1"
  remote="${remote%.git}"
  if [[ "$remote" =~ ^git@github\.com:(.+/.+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$remote" =~ ^https?://github\.com/(.+/.+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf '%s\n' "$remote"
}

read_origin_url() {
  local git_dir="$1"
  awk '
    /^\[remote "origin"\]$/ { in_remote=1; next }
    /^\[/ { in_remote=0 }
    in_remote && /^[[:space:]]*url[[:space:]]*=/ {
      sub(/^[[:space:]]*url[[:space:]]*=[[:space:]]*/, "", $0)
      print
      exit
    }
  ' "$git_dir/config"
}

read_packed_ref() {
  local git_dir="$1"
  local ref_name="$2"
  local packed_refs="$git_dir/packed-refs"

  if [[ ! -f "$packed_refs" ]]; then
    return 1
  fi

  awk -v ref="$ref_name" '
    $0 ~ /^[0-9a-f]{40} / && $2 == ref { print $1; exit }
  ' "$packed_refs"
}

read_head_ref() {
  local git_dir="$1"
  local head_file="$git_dir/HEAD"
  local head_content

  if [[ ! -f "$head_file" ]]; then
    return 1
  fi

  head_content="$(head -n 1 "$head_file")"
  if [[ "$head_content" == ref:\ * ]]; then
    printf '%s\n' "${head_content#ref: }"
  fi
}

read_head_commit() {
  local git_dir="$1"
  local head_file="$git_dir/HEAD"
  local head_content ref_file

  if [[ ! -f "$head_file" ]]; then
    return 1
  fi

  head_content="$(head -n 1 "$head_file")"
  if [[ "$head_content" == ref:\ * ]]; then
    ref_file="$git_dir/${head_content#ref: }"
    if [[ -f "$ref_file" ]]; then
      head -n 1 "$ref_file"
      return 0
    fi
    read_packed_ref "$git_dir" "${head_content#ref: }"
    return 0
  fi

  printf '%s\n' "$head_content"
}

simplify_ref() {
  local ref="$1"
  case "$ref" in
    refs/heads/*)
      printf '%s\n' "${ref#refs/heads/}"
      ;;
    refs/tags/*)
      printf '%s\n' "${ref#refs/tags/}"
      ;;
    refs/remotes/*)
      printf '%s\n' "${ref#refs/remotes/}"
      ;;
    *)
      printf '%s\n' "$ref"
      ;;
  esac
}

NAME="${NAME:-$(json_field "$PACKAGE_JSON" name)}"
DISPLAY_NAME="${DISPLAY_NAME:-$(json_field "$PLUGIN_JSON" name)}"
VERSION="${VERSION:-$(json_field "$PACKAGE_JSON" version)}"

if [[ -z "$NAME" || -z "$DISPLAY_NAME" || -z "$VERSION" ]]; then
  echo "Failed to resolve name/display-name/version from package metadata" >&2
  exit 1
fi

if REPO_ROOT="$(find_repo_root "$TARGET_DIR")"; then
  if GIT_DIR="$(resolve_git_dir "$REPO_ROOT")"; then
    if [[ -z "$SOURCE_REPO" && -f "$GIT_DIR/config" ]]; then
      SOURCE_REPO="$(read_origin_url "$GIT_DIR" || true)"
      if [[ -n "$SOURCE_REPO" ]]; then
        SOURCE_REPO="$(normalize_repo "$SOURCE_REPO")"
      fi
    fi

    if [[ -z "$SOURCE_COMMIT" ]]; then
      SOURCE_COMMIT="$(read_head_commit "$GIT_DIR" || true)"
    fi

    if [[ -z "$SOURCE_REF" ]]; then
      RAW_REF="$(read_head_ref "$GIT_DIR" || true)"
      if [[ -n "${RAW_REF:-}" ]]; then
        SOURCE_REF="$(simplify_ref "$RAW_REF")"
      fi
    fi

    if [[ -z "$SOURCE_PATH" ]]; then
      if [[ "$TARGET_DIR" == "$REPO_ROOT" ]]; then
        SOURCE_PATH="."
      else
        SOURCE_PATH="${TARGET_DIR#$REPO_ROOT/}"
      fi
    fi
  fi
fi

if [[ -z "$SOURCE_REPO" || -z "$SOURCE_COMMIT" ]]; then
  echo "clawhub package publish requires --source-repo and --source-commit" >&2
  echo "Auto-detection from local .git metadata failed. Pass them explicitly or set SOURCE_REPO and SOURCE_COMMIT." >&2
  exit 1
fi

cmd=(
  clawhub
  package
  publish
  "$TARGET_DIR"
  --family "$FAMILY"
  --name "$NAME"
  --display-name "$DISPLAY_NAME"
  --version "$VERSION"
  --tags "$TAGS"
)

if [[ -n "$CHANGELOG" ]]; then
  cmd+=(--changelog "$CHANGELOG")
fi

if [[ -n "$SOURCE_REPO" ]]; then
  cmd+=(--source-repo "$SOURCE_REPO" --source-commit "$SOURCE_COMMIT")
fi

if [[ -n "$SOURCE_REF" ]]; then
  cmd+=(--source-ref "$SOURCE_REF")
fi

if [[ -n "$SOURCE_PATH" ]]; then
  cmd+=(--source-path "$SOURCE_PATH")
fi

printf 'Resolved publish command:\n'
printf ' %q' "${cmd[@]}"
printf '\n'

if [[ $DRY_RUN -eq 1 ]]; then
  exit 0
fi

"${cmd[@]}"

#!/bin/sh
set -eu

KEYCHAIN_SERVICE="MyGoSoloist"
KEYCHAIN_ACCOUNT="${USER:-$(id -un 2>/dev/null || echo soloist)}"
HOME_DIR="${HOME:-}"
if [ -z "$HOME_DIR" ]; then
  echo "HOME directory is not set." >&2
  exit 1
fi

STAGING_ROOT="$HOME_DIR/Library/Caches/MyGoSoloist/staging"
STAGED_BIN="$STAGING_ROOT/soloist"
STAGED_META="$STAGING_ROOT/meta.json"
DOWNLOAD_URL="https://soloist-builds.spotifycdn.com/soloist_release_osx_arm64.tar.gz"
DATA_DIR="$HOME_DIR/Library/Application Support/soloist"
CACHE_DIR="$HOME_DIR/Library/Caches/soloist"

ACTION="${1:-config}"
if [ "$#" -gt 0 ]; then
  shift
fi

PLUGIN_DIR=""
FORCE_DOWNLOAD=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plugin-dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --plugin-dir." >&2
        exit 1
      fi
      PLUGIN_DIR="$2"
      shift 2
      ;;
    --force-download)
      FORCE_DOWNLOAD=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

fail() {
  if [ "$ACTION" = "stage" ] || [ "$ACTION" = "install" ] || [ "$ACTION" = "setup" ]; then
    printf '%s\n' "$1" >&2
  else
    printf '%s\n' "Soloist helper failed. Check the local key configuration or run setup again." >&2
  fi
  exit 1
}

json_escape() {
  awk 'BEGIN { ORS = "" } {
    if (NR > 1) printf "\\n"
    gsub(/\\/, "\\\\")
    gsub(/"/, "\\\"")
    gsub(/\r/, "\\r")
    gsub(/\t/, "\\t")
    print
  }'
}

json_str() {
  printf '"%s"' "$(printf '%s' "$1" | json_escape)"
}

normalize_etag() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^[Ww]\///' -e 's/^"*//' -e 's/"*$//'
}

read_meta_field() {
  file="$1"
  key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  awk -v k="\"$key\":" '
    {
      idx = index($0, k)
      if (idx > 0) {
        rest = substr($0, idx + length(k))
        sub(/^[[:space:]]*"/, "", rest)
        out = ""
        esc = 0
        for (i = 1; i <= length(rest); i++) {
          ch = substr(rest, i, 1)
          if (esc) {
            if (ch == "n") out = out "\n"
            else if (ch == "r") out = out "\r"
            else if (ch == "t") out = out "\t"
            else out = out ch
            esc = 0
          } else if (ch == "\\") {
            esc = 1
          } else if (ch == "\"") {
            break
          } else {
            out = out ch
          }
        }
        print out
        exit
      }
    }
  ' "$file"
}

check_macos_arm64() {
  os_name="$(uname -s 2>/dev/null || true)"
  arch_name="$(uname -m 2>/dev/null || true)"
  if [ "$os_name" != "Darwin" ] || [ "$arch_name" != "arm64" ]; then
    fail "Spotify Soloist on macOS currently supports Apple Silicon (arm64) only."
  fi
}

parse_soloist_version() {
  exe_path="$1"
  raw="$("$exe_path" --version 2>&1)" || return 1
  first_line="$(printf '%s\n' "$raw" | head -n 1 | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  PARSED_VERSION=""
  PARSED_BUILD_TS=""
  PARSED_VERSION_TEXT="$first_line"
  parsed="$(printf '%s\n' "$first_line" | awk '
    {
      low = tolower($0)
      if (low ~ /^soloist[[:space:]]+[0-9][^[:space:]]*[[:space:]]+build[[:space:]]+[0-9]+/ &&
          low ~ /(macos|darwin|osx)\/(arm64|aarch64)/) {
        print $2 "\t" $4
      }
    }
  ')"
  if [ -z "$parsed" ]; then
    return 1
  fi
  PARSED_VERSION="$(printf '%s' "$parsed" | cut -f1)"
  PARSED_BUILD_TS="$(printf '%s' "$parsed" | cut -f2)"
  return 0
}

stage_soloist() {
  check_macos_arm64
  mkdir -p "$STAGING_ROOT"
  work_dir="$(mktemp -d "$STAGING_ROOT/dl-XXXXXX")"
  cleanup_stage() {
    rm -rf "$work_dir" 2>/dev/null || true
  }
  trap cleanup_stage EXIT INT TERM

  tgz_path="$work_dir/soloist.tar.gz"
  headers_path="$work_dir/headers.txt"
  extract_dir="$work_dir/extract"
  mkdir -p "$extract_dir"

  curl -fsSL --connect-timeout 30 --max-time 90 -D "$headers_path" -o "$tgz_path" "$DOWNLOAD_URL" \
    || fail "Failed to download official Spotify Soloist archive."

  # Extract headers from the final HTTP response block (in case of redirects).
  final_headers="$(awk '
    BEGIN { block = "" }
    /^HTTP\// { block = ""; next }
    { block = block $0 "\n" }
    END { printf "%s", block }
  ' "$headers_path")"

  raw_etag="$(printf '%s\n' "$final_headers" | awk 'tolower($0) ~ /^etag:/ { sub(/^[^:]*:[[:space:]]*/, ""); val=$0 } END { print val }')"
  raw_lm="$(printf '%s\n' "$final_headers" | awk 'tolower($0) ~ /^last-modified:/ { sub(/^[^:]*:[[:space:]]*/, ""); val=$0 } END { print val }')"
  raw_len="$(printf '%s\n' "$final_headers" | awk 'tolower($0) ~ /^content-length:/ { sub(/^[^:]*:[[:space:]]*/, ""); val=$0 } END { print val }')"

  STAGED_ETAG="$(normalize_etag "$raw_etag")"
  STAGED_LAST_MODIFIED="$(printf '%s' "$raw_lm" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  expected_len="$(printf '%s' "$raw_len" | tr -d '\r[:space:]')"

  actual_len="$(stat -f%z "$tgz_path" 2>/dev/null || echo 0)"
  if [ "$actual_len" -le 0 ]; then
    fail "Downloaded archive size mismatch."
  fi
  if [ -n "$expected_len" ] && printf '%s' "$expected_len" | grep -Eq '^[0-9]+$' && [ "$expected_len" -gt 0 ]; then
    if [ "$actual_len" -ne "$expected_len" ]; then
      fail "Downloaded archive size mismatch."
    fi
  fi

  if printf '%s' "$STAGED_ETAG" | grep -Eq '^[0-9a-fA-F]{32}$'; then
    actual_md5="$(md5 -q "$tgz_path" | tr '[:upper:]' '[:lower:]')"
    expected_md5="$(printf '%s' "$STAGED_ETAG" | tr '[:upper:]' '[:lower:]')"
    if [ "$actual_md5" != "$expected_md5" ]; then
      fail "Downloaded archive checksum mismatch."
    fi
  fi

  tar -xzf "$tgz_path" -C "$extract_dir" || fail "Failed to extract Spotify Soloist archive."
  candidate="$(find "$extract_dir" -type f -name soloist | head -n 1)"
  if [ -z "$candidate" ] || [ ! -f "$candidate" ]; then
    fail "Archive did not contain soloist."
  fi

  chmod 755 "$candidate"
  xattr -d com.apple.quarantine "$candidate" 2>/dev/null || true

  parse_soloist_version "$candidate" || fail "Downloaded soloist failed version verification."

  staged_at="$(($(date +%s) * 1000))"
  tmp_staged="$STAGING_ROOT/soloist.tmp.$$"
  mv -f "$candidate" "$tmp_staged"
  mv -f "$tmp_staged" "$STAGED_BIN"

  meta_json="$(printf '{"version":%s,"buildTimestamp":%s,"versionText":%s,"etag":%s,"lastModified":%s,"stagedAt":%s}' \
    "$(json_str "$PARSED_VERSION")" \
    "$PARSED_BUILD_TS" \
    "$(json_str "$PARSED_VERSION_TEXT")" \
    "$(json_str "$STAGED_ETAG")" \
    "$(json_str "$STAGED_LAST_MODIFIED")" \
    "$staged_at")"
  printf '%s\n' "$meta_json" > "$STAGED_META.tmp.$$"
  mv -f "$STAGED_META.tmp.$$" "$STAGED_META"

  rm -rf "$work_dir" 2>/dev/null || true
  trap - EXIT INT TERM
}

stop_target_soloist() {
  target_bin="$1"
  pids="$(ps -ax -o pid=,command= 2>/dev/null | awk -v target="$target_bin" '
    {
      pid = $1
      $1 = ""
      sub(/^[[:space:]]+/, "")
      if (index($0, target) == 1) {
        rest = substr($0, length(target) + 1)
        if (rest == "" || substr(rest, 1, 1) == " ") print pid
      }
    }
  ')"
  if [ -z "$pids" ]; then
    return 0
  fi
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  i=0
  while [ "$i" -lt 20 ]; do
    still=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        still="$still $pid"
      fi
    done
    if [ -z "$still" ]; then
      return 0
    fi
    sleep 0.15
    i=$((i + 1))
  done
  for pid in $pids; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}

install_soloist() {
  check_macos_arm64
  if [ -z "$PLUGIN_DIR" ] || [ ! -d "$PLUGIN_DIR" ]; then
    fail "Invalid plugin directory."
  fi
  plugin_full="$(cd "$PLUGIN_DIR" && pwd -P)"
  if [ ! -f "$plugin_full/plugin.json" ]; then
    fail "Target directory is not a valid plugin folder."
  fi

  have_staged=0
  if [ "$FORCE_DOWNLOAD" -eq 0 ] && [ -f "$STAGED_BIN" ]; then
    if parse_soloist_version "$STAGED_BIN" 2>/dev/null; then
      now_sec="$(date +%s)"
      age_sec=$((now_sec - PARSED_BUILD_TS))
      if [ "$age_sec" -lt $((89 * 86400)) ]; then
        STAGED_ETAG="$(read_meta_field "$STAGED_META" "etag")"
        STAGED_LAST_MODIFIED="$(read_meta_field "$STAGED_META" "lastModified")"
        have_staged=1
      fi
    fi
  fi

  if [ "$have_staged" -eq 0 ]; then
    stage_soloist
  fi

  bin_dir="$plugin_full/bin"
  mkdir -p "$bin_dir"
  target_bin="$bin_dir/soloist"
  incoming_bin="$bin_dir/soloist.new.$$.$(date +%s)"
  backup_bin="$bin_dir/soloist.bak"

  cleanup_install() {
    rm -f "$incoming_bin" 2>/dev/null || true
  }
  trap cleanup_install EXIT INT TERM

  cp "$STAGED_BIN" "$incoming_bin"
  chmod 755 "$incoming_bin"
  xattr -d com.apple.quarantine "$incoming_bin" 2>/dev/null || true

  stop_target_soloist "$target_bin"

  backed_up=0
  if [ -f "$target_bin" ]; then
    rm -f "$backup_bin" 2>/dev/null || true
    mv -f "$target_bin" "$backup_bin"
    backed_up=1
  fi

  if ! mv -f "$incoming_bin" "$target_bin"; then
    if [ "$backed_up" -eq 1 ] && [ -f "$backup_bin" ] && [ ! -f "$target_bin" ]; then
      mv -f "$backup_bin" "$target_bin" 2>/dev/null || true
    fi
    fail "Failed to replace bin/soloist."
  fi

  if [ "$backed_up" -eq 1 ]; then
    rm -f "$backup_bin" 2>/dev/null || true
  fi
  rm -f "$STAGED_BIN" "$STAGED_META" 2>/dev/null || true
  trap - EXIT INT TERM

  printf '{"installed":true,"version":%s,"buildTimestamp":%s,"versionText":%s,"etag":%s,"lastModified":%s}\n' \
    "$(json_str "$PARSED_VERSION")" \
    "$PARSED_BUILD_TS" \
    "$(json_str "$PARSED_VERSION_TEXT")" \
    "$(json_str "$STAGED_ETAG")" \
    "$(json_str "$STAGED_LAST_MODIFIED")"
}

case "$ACTION" in
  setup)
    printf 'Paste your personal Soloist API key (hidden input): '
    stty -echo 2>/dev/null || true
    IFS= read -r key || key=""
    stty echo 2>/dev/null || true
    printf '\n'
    key="$(printf '%s' "$key" | tr -d '\r\n')"
    if [ -z "$key" ]; then
      fail "No API key entered."
    fi
    security add-generic-password -U -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w "$key" >/dev/null \
      || fail "Could not save API key to macOS Keychain."
    key=""
    printf '%s\n' "Saved in macOS Keychain for this user. Restart the plugin, then play a song."
    ;;
  stage)
    stage_soloist
    printf '{"staged":true,"version":%s,"buildTimestamp":%s,"versionText":%s,"etag":%s,"lastModified":%s}\n' \
      "$(json_str "$PARSED_VERSION")" \
      "$PARSED_BUILD_TS" \
      "$(json_str "$PARSED_VERSION_TEXT")" \
      "$(json_str "$STAGED_ETAG")" \
      "$(json_str "$STAGED_LAST_MODIFIED")"
    ;;
  install)
    install_soloist
    ;;
  config)
    key="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)" \
      || fail "Run scripts/soloist-host.sh setup to save your Soloist API key first."
    key="$(printf '%s' "$key" | tr -d '\r\n')"
    if [ -z "$key" ]; then
      fail "Run scripts/soloist-host.sh setup to save your Soloist API key first."
    fi
    # stdout is consumed only by the plugin. Never log this response.
    printf '{"key":%s,"dataDir":%s,"cacheDir":%s}\n' \
      "$(json_str "$key")" \
      "$(json_str "$DATA_DIR")" \
      "$(json_str "$CACHE_DIR")"
    key=""
    ;;
  *)
    fail "Unknown action: $ACTION"
    ;;
esac

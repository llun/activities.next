#!/usr/bin/env bash
# Run: bash .buildkite/scripts/github-status.test.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: $desc"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    FAILURES=$((FAILURES + 1))
  else
    echo "PASS: $desc"
  fi
}

# --- case 1: GITHUB_STATUS_CONTEXT unset -> no-op, curl never called ---
(
  unset GITHUB_STATUS_CONTEXT GITHUB_TOKEN GITHUB_REPO_SLUG BUILDKITE_COMMIT
  CURL_CALLED=0
  curl() { CURL_CALLED=1; }
  # shellcheck source=./github-status.sh
  source "$DIR/github-status.sh"
  post_github_status "success" "Passed"
  echo "$CURL_CALLED" > "$DIR/.test-curl-called"
)
assert_eq "no-op when GITHUB_STATUS_CONTEXT unset" "0" "$(cat "$DIR/.test-curl-called")"
rm -f "$DIR/.test-curl-called"

# --- case 2: context set, token missing -> aborts the (sub)shell loudly ---
(
  export GITHUB_STATUS_CONTEXT="Build"
  unset GITHUB_TOKEN
  # shellcheck source=./github-status.sh
  source "$DIR/github-status.sh"
  post_github_status "success" "Passed"
) 2>/dev/null
assert_eq "aborts when GITHUB_TOKEN missing" "1" "$?"

# --- case 3: happy path -> curl called with expected URL and payload ---
(
  export GITHUB_STATUS_CONTEXT="Build"
  export GITHUB_TOKEN="test-token"
  export GITHUB_REPO_SLUG="llun/activities.next"
  export BUILDKITE_COMMIT="abc123"
  export BUILDKITE_BUILD_URL="https://buildkite.example/builds/1"
  curl() { echo "$*" > "$DIR/.test-curl-args"; }
  # shellcheck source=./github-status.sh
  source "$DIR/github-status.sh"
  post_github_status "success" "Passed"
)
CURL_ARGS=$(cat "$DIR/.test-curl-args" 2>/dev/null || echo "")
rm -f "$DIR/.test-curl-args"
case "$CURL_ARGS" in
  *https://api.github.com/repos/llun/activities.next/statuses/abc123*\"state\":\"success\"*\"context\":\"Build\"*)
    echo "PASS: happy path posts expected URL and payload" ;;
  *)
    echo "FAIL: happy path posts expected URL and payload"
    echo "  got: $CURL_ARGS"
    FAILURES=$((FAILURES + 1)) ;;
esac

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES assertion(s) failed"
  exit 1
fi
echo "All github-status.sh tests passed."

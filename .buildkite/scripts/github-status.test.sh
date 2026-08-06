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

# --- case 3: happy path with escaping -> all four JSON fields, proper escaping for description with quote ---
(
  export GITHUB_STATUS_CONTEXT="Build"
  export GITHUB_TOKEN="test-token"
  export GITHUB_REPO_SLUG="llun/activities.next"
  export BUILDKITE_COMMIT="abc123"
  export BUILDKITE_BUILD_URL="https://buildkite.example/builds/1"
  curl() {
    # Save arguments for inspection
    echo "$*" > "$DIR/.test-curl-args"
    # Output success response (200)
    printf '{"state":"success"}
200'
  }
  # shellcheck source=./github-status.sh
  source "$DIR/github-status.sh"
  post_github_status "success" 'Test passed with "quotes"'
)
CURL_ARGS=$(cat "$DIR/.test-curl-args" 2>/dev/null || echo "")
rm -f "$DIR/.test-curl-args"
# Verify all four JSON fields are present and properly escaped
if printf '%s' "$CURL_ARGS" | grep -q 'https://api.github.com/repos/llun/activities.next/statuses/abc123' && \
   printf '%s' "$CURL_ARGS" | grep -q '"state":"success"' && \
   printf '%s' "$CURL_ARGS" | grep -q '"context":"Build"' && \
   printf '%s' "$CURL_ARGS" | grep -q '"description":"Test passed with \\"quotes\\""' && \
   printf '%s' "$CURL_ARGS" | grep -q '"target_url":"https://buildkite.example/builds/1"'; then
  echo "PASS: happy path posts all fields with proper escaping"
else
  echo "FAIL: happy path posts all fields with proper escaping"
  echo "  got: $CURL_ARGS"
  FAILURES=$((FAILURES + 1))
fi

# --- case 4: non-2xx response -> prints error to stderr and returns 1 ---
(
  export GITHUB_STATUS_CONTEXT="Build"
  export GITHUB_TOKEN="test-token"
  export GITHUB_REPO_SLUG="llun/activities.next"
  export BUILDKITE_COMMIT="abc123"
  unset BUILDKITE_BUILD_URL
  curl() {
    # Mock curl: output response body, then newline, then status code
    printf 'Not Found
401'
  }
  # shellcheck source=./github-status.sh
  source "$DIR/github-status.sh"
  post_github_status "failure" "Build failed" 2>"$DIR/.test-failure-stderr"
  echo "$?" > "$DIR/.test-failure-exit-code"
)
EXIT_CODE=$(cat "$DIR/.test-failure-exit-code" 2>/dev/null || echo "0")
STDERR=$(cat "$DIR/.test-failure-stderr" 2>/dev/null || echo "")
rm -f "$DIR/.test-failure-exit-code" "$DIR/.test-failure-stderr"
assert_eq "non-2xx response returns exit code 1" "1" "$EXIT_CODE"
if printf '%s' "$STDERR" | grep -q 'error: GitHub status POST failed with 401' && \
   printf '%s' "$STDERR" | grep -q 'context: Build' && \
   printf '%s' "$STDERR" | grep -q 'Not Found'; then
  echo "PASS: non-2xx response prints error to stderr with status and context"
else
  echo "FAIL: non-2xx response prints error to stderr with status and context"
  echo "  got stderr: $STDERR"
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES assertion(s) failed"
  exit 1
fi
echo "All github-status.sh tests passed."

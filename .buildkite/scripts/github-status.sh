# Shared GitHub commit-status helper for Buildkite.
#
# Meant to be `source`d, not executed directly. Deliberately does not set
# any shell options (-e/-u/pipefail) here — those would silently change the
# behavior of whatever script sources this one.

# Helper to escape a string for JSON (backslash, double-quote, newline).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/$/\\n/g' | tr -d '\n' | sed 's/\\n$//'
}

post_github_status() {
  local state="$1"
  local description="${2:-}"

  if [ -z "${GITHUB_STATUS_CONTEXT:-}" ]; then
    return 0
  fi

  : "${GITHUB_TOKEN:?GITHUB_TOKEN must be set to post GitHub commit statuses}"
  : "${GITHUB_REPO_SLUG:?GITHUB_REPO_SLUG must be set (e.g. llun/activities.next)}"
  : "${BUILDKITE_COMMIT:?BUILDKITE_COMMIT must be set}"

  local state_escaped context_escaped description_escaped url_escaped
  state_escaped=$(json_escape "$state")
  context_escaped=$(json_escape "$GITHUB_STATUS_CONTEXT")
  description_escaped=$(json_escape "$description")
  url_escaped=$(json_escape "${BUILDKITE_BUILD_URL:-}")

  local payload
  payload=$(printf '{"state":"%s","context":"%s","description":"%s","target_url":"%s"}' \
    "$state_escaped" "$context_escaped" "$description_escaped" "$url_escaped")

  local response status body
  # Retry transient GitHub API failures: pre-command runs under `set -e`, so a
  # single 5xx or dropped connection would abort the step before any real work.
  response=$(curl -sS -w '\n%{http_code}' \
    --retry 3 --retry-connrefused --retry-all-errors --max-time 30 \
    -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPO_SLUG}/statuses/${BUILDKITE_COMMIT}" \
    -d "$payload")

  # Extract status code (last 3 digits after newline) and body (everything before)
  status=$(printf '%s' "$response" | tail -1)
  body=$(printf '%s' "$response" | sed '$d')

  if [ "${status%${status#?}}" != "2" ]; then
    printf 'error: GitHub status POST failed with %s\n' "$status" >&2
    printf 'context: %s\n' "$GITHUB_STATUS_CONTEXT" >&2
    printf 'response body:\n%s\n' "$body" >&2
    return 1
  fi
}

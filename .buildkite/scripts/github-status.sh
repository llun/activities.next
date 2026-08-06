# Shared GitHub commit-status helper for Buildkite.
#
# Meant to be `source`d, not executed directly. Deliberately does not set
# any shell options (-e/-u/pipefail) here — those would silently change the
# behavior of whatever script sources this one.

post_github_status() {
  local state="$1"
  local description="${2:-}"

  if [ -z "${GITHUB_STATUS_CONTEXT:-}" ]; then
    return 0
  fi

  : "${GITHUB_TOKEN:?GITHUB_TOKEN must be set to post GitHub commit statuses}"
  : "${GITHUB_REPO_SLUG:?GITHUB_REPO_SLUG must be set (e.g. llun/activities.next)}"
  : "${BUILDKITE_COMMIT:?BUILDKITE_COMMIT must be set}"

  local payload
  payload=$(printf '{"state":"%s","context":"%s","description":"%s","target_url":"%s"}' \
    "$state" "$GITHUB_STATUS_CONTEXT" "$description" "${BUILDKITE_BUILD_URL:-}")

  curl -sS -o /dev/null \
    -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPO_SLUG}/statuses/${BUILDKITE_COMMIT}" \
    -d "$payload"
}

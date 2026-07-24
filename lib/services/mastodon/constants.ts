// The number of media attachments Mastodon (and the wider fediverse) render on
// a status. We may store more than this locally, but the outbound ActivityPub
// note only carries the first MAX_FEDERATION_MEDIA_ATTACHMENTS so remote servers
// receive a Mastodon-compatible payload.
export const MAX_FEDERATION_MEDIA_ATTACHMENTS = 4

// Upper bound on how many media a single status may store / accept through the
// create and edit APIs. Purely a safety ceiling so one status can't fan out an
// unbounded number of media lookups; the fediverse still only ever sees the
// first MAX_FEDERATION_MEDIA_ATTACHMENTS of them.
export const MAX_STORED_MEDIA_ATTACHMENTS = 20

export const MAX_PINNED_STATUSES = 5

// Poll limits, matching Mastodon's defaults
// (Poll::Options#options + Status::MIN/MAX expiry).
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 4
export const MAX_POLL_OPTION_CHARS = 50
// 5 minutes minimum, ~1 month maximum (seconds).
export const MIN_POLL_EXPIRATION_SECONDS = 5 * 60
export const MAX_POLL_EXPIRATION_SECONDS = 60 * 60 * 24 * 31

// Absolute safety ceilings for the poll create/edit request schema. The
// admin-configured poll limits (server settings) are enforced at runtime and
// never exceed these, so the schema stays bounded regardless of settings while
// still allowing an admin to raise the limits above the Mastodon defaults.
export const POLL_OPTIONS_CEILING = 50
export const POLL_OPTION_CHARS_CEILING = 1000

// Mastodon rejects a scheduled_at less than five minutes in the future.
export const MIN_SCHEDULED_STATUS_AHEAD_MS = 5 * 60 * 1000
export const SCHEDULED_AT_TOO_SOON_ERROR =
  'Validation failed: Scheduled at must be at least 5 minutes in the future'

// Advertised in the v2 instance entity (api_versions.mastodon). Mastodon exposes
// this as a single monotonic integer bumped per release (4.3 → 2, 4.4 → 6,
// 4.5 → 7, 4.6 → 10). Mastodon 4.5 introduced quote posts and its client guide
// gates quote authoring on api_versions.mastodon >= 7, so this server — which
// implements the 4.5 quote-post surface — advertises 7. Streaming stays
// unadvertised (configuration.urls.streaming is empty), so no streaming
// capability is claimed.
export const MASTODON_INSTANCE_API_VERSION = 7

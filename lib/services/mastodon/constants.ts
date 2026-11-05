// Upper bound on how many media a single status may store / accept through the
// create and edit APIs, and how many a federated Note keeps at ingest
// (`getAttachments`). Purely a safety ceiling so one status can't fan out an
// unbounded number of media lookups. The outbound Note carries every
// non-fitness attachment, as Pixelfed does; Mastodon keeps only the first 4 of
// a remote post on its side.
export const MAX_STORED_MEDIA_ATTACHMENTS = 50

// The media a status may carry besides its route map. A fitness file takes
// one slot: its processing job attaches the activity's generated route map
// after the create returns (and a retry or a map regeneration can attach one
// later), so a fitness post accepts one fewer photo, on create and on edit,
// and the photos plus the map still fit MAX_STORED_MEDIA_ATTACHMENTS. Without
// the reserved slot the stored set ends one over the ceiling, and an edit that
// sends every media id back is refused.
export const getMaxStatusMediaAttachments = (hasFitnessFile: boolean) =>
  hasFitnessFile
    ? MAX_STORED_MEDIA_ATTACHMENTS - 1
    : MAX_STORED_MEDIA_ATTACHMENTS

export const MAX_PINNED_STATUSES = 5

// Mastodon's default status length, and the fallback for the admin-configurable
// `posts.maxCharacters` server setting. It lives in this dependency-free module
// so both the settings registry (lib/config/serverSettings) and the browser
// composer can read it — importing the registry into a Client Component would
// drag its env-reading closures into the client bundle.
export const DEFAULT_MAX_STATUS_CHARACTERS = 500

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
// Refused on a server whose queue cannot run delayed jobs (NoQueue), where a
// scheduled status would be stored and never published.
export const SCHEDULED_STATUSES_UNAVAILABLE_ERROR =
  'Validation failed: Scheduled at is not available on this server'

// Mastodon's ListAccount :must_be_following error: a list member other than
// the owner needs a follow or a pending follow request.
export const LIST_ACCOUNT_NOT_FOLLOWED_ERROR =
  'Validation failed: Account must be a followed account'

// Advertised in the v2 instance entity (api_versions.mastodon). Mastodon exposes
// this as a single monotonic integer bumped per release (4.3 → 2, 4.4 → 6,
// 4.5 → 7, 4.6 → 10). Mastodon 4.5 introduced quote posts and its client guide
// gates quote authoring on api_versions.mastodon >= 7, so this server — which
// implements the 4.5 quote-post surface — advertises 7. Streaming stays
// unadvertised (configuration.urls.streaming is empty), so no streaming
// capability is claimed.
export const MASTODON_INSTANCE_API_VERSION = 7

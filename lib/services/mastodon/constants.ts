export const MAX_STATUS_MEDIA_ATTACHMENTS = 4
export const MAX_PINNED_STATUSES = 5

// Poll limits, matching Mastodon's defaults
// (Poll::Options#options + Status::MIN/MAX expiry).
export const MIN_POLL_OPTIONS = 2
export const MAX_POLL_OPTIONS = 4
export const MAX_POLL_OPTION_CHARS = 50
// 5 minutes minimum, ~1 month maximum (seconds).
export const MIN_POLL_EXPIRATION_SECONDS = 5 * 60
export const MAX_POLL_EXPIRATION_SECONDS = 60 * 60 * 24 * 31

// Mastodon rejects a scheduled_at less than five minutes in the future.
export const MIN_SCHEDULED_STATUS_AHEAD_MS = 5 * 60 * 1000
export const SCHEDULED_AT_TOO_SOON_ERROR =
  'Validation failed: Scheduled at must be at least 5 minutes in the future'

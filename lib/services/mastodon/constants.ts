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

// Maximum file size is 200 MB for video
export const MAX_FILE_SIZE = 209_715_200
// The ceiling an admin may raise the `media.maxFileSize` server setting to
// (1 GiB). MAX_FILE_SIZE above is only the default. The files route streams
// stored objects, but the synchronous upload path reads a whole upload into
// memory, so an unbounded cap is an OOM.
export const MAX_CONFIGURABLE_FILE_SIZE = 1_073_741_824
// Max bytes to download and analyze for blurhash/focus in presigned upload completion (100 MB)
export const PRESIGNED_ANALYSIS_MAX_BYTES = 104_857_600
// The most attachments a fitness import will leave on one activity status —
// counted across everything already on it (the route map included), not just
// the photos being added. Both Strava import paths subtract the existing
// attachments from this and fill what is left.
//
// It is NOT the composer's cap and NOT a Mastodon limit. The authoring UI caps
// itself at the admin-configured `posts.maxMediaAttachments` via
// `useInstanceLimits()` (lib/components/instance-limits.tsx), and Mastodon's
// 4-attachment limit is `MAX_FEDERATION_MEDIA_ATTACHMENTS`, applied when a note
// is serialised outbound — so an imported status federates 4 however many it
// stores, while local surfaces still show them all.
//
// The value is inherited: it was the composer's upload cap before that moved to
// the server setting, so 10 is a historical number rather than a reasoned one.
// Kept as-is here to avoid a behaviour change; see the PR discussion.
export const MAX_IMPORTED_ACTIVITY_ATTACHMENTS = 10
export const MAX_WIDTH = 4000
export const MAX_HEIGHT = 4000

// Default quota per account is 1GB (1,073,741,824 bytes)
export const DEFAULT_QUOTA_PER_ACCOUNT = 1_073_741_824

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png']

export const ACCEPTED_FILE_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  'video/quicktime',
  'video/mp4',
  'video/webm',
  'audio/mp4'
]

// Mastodon caps media descriptions (alt text) at 1,500 characters.
// https://docs.joinmastodon.org/user/posting/#media
export const MAX_MEDIA_DESCRIPTION_LENGTH = 1500

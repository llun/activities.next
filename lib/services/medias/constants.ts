// Maximum file size is 200 MB for video
export const MAX_FILE_SIZE = 209_715_200
// The ceiling an admin may raise the `media.maxFileSize` server setting to
// (1 GiB). MAX_FILE_SIZE above is only the default; the object-storage read
// path bounds itself by the resolved setting, so the cap can move without
// storing media the driver would refuse to serve. This ceiling exists because
// the read path buffers an object in memory, so an unbounded cap is an OOM.
export const MAX_CONFIGURABLE_FILE_SIZE = 1_073_741_824
// Max bytes to download and analyze for blurhash/focus in presigned upload completion (50 MB)
export const PRESIGNED_ANALYSIS_MAX_BYTES = 52_428_800
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

// sharp resize options shared by every stored-image pipeline (LocalFileStorage
// and S3FileStorage), kept in one place so the two cannot drift apart.
//
// `withoutEnlargement` is load-bearing: sharp's `fit: 'inside'` ENLARGES by
// default, so without it the MAX_WIDTH/MAX_HEIGHT box stops being a cap and
// becomes an upscale — every image below 4000x4000 was blown up to fill it. An
// 800x600 route map (39 KB PNG) was stored as a 4000x3000 WebP of 271 KB, a
// size no surface ever displays. Matches `lib/utils/resizeImage.ts`, which the
// browser upload path already applies as a downscale-only cap.
export const STORED_IMAGE_RESIZE_OPTIONS = {
  fit: 'inside',
  withoutEnlargement: true
} as const

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

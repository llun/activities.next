// Maximum file size is 200 MB for video
export const MAX_FILE_SIZE = 209_715_200
// The ceiling an admin may raise the `media.maxFileSize` server setting to
// (1 GiB). MAX_FILE_SIZE above is only the default; the object-storage read
// path bounds itself by the resolved setting, so the cap can move without
// storing media the driver would refuse to serve. This ceiling exists because
// the read path buffers an object in memory, so an unbounded cap is an OOM.
export const MAX_CONFIGURABLE_FILE_SIZE = 1_073_741_824
// How many photos a Strava import may attach to one activity post. This is an
// import-side fan-out bound, NOT the composer's cap: the authoring UI caps
// itself at the admin-configured `posts.maxMediaAttachments` read through
// `useInstanceLimits()` (see lib/components/instance-limits.tsx), which is also
// the value the instance entity advertises as `max_media_attachments`.
export const MAX_ATTACHMENTS = 10
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

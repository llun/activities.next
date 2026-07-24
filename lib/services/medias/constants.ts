// Maximum file size is 200 MB for video
export const MAX_FILE_SIZE = 209_715_200
// The ceiling an admin may raise the `media.maxFileSize` server setting to
// (1 GiB). MAX_FILE_SIZE above is only the default; the object-storage read
// path bounds itself by the resolved setting, so the cap can move without
// storing media the driver would refuse to serve. This ceiling exists because
// the read path buffers an object in memory, so an unbounded cap is an OOM.
export const MAX_CONFIGURABLE_FILE_SIZE = 1_073_741_824
export const MAX_ATTACHMENTS = 10
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

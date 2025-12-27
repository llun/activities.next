// Maximum file size is 200 MB for video
export const MAX_FILE_SIZE = 209_715_200
export const MAX_ATTACHMENTS = 10
export const MAX_WIDTH = 4000
export const MAX_HEIGHT = 4000

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png']

export const ACCEPTED_FILE_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  'video/quicktime',
  'video/mp4',
  'video/webm',
  'audio/mp4'
]

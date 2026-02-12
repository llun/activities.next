import { z } from 'zod'

import { Document } from '@/lib/types/activitypub/objects'
import * as Mastodon from '@/lib/types/mastodon'

const FITNESS_FILE_EXTENSIONS = ['.fit', '.gpx', '.tcx']
const FITNESS_MEDIA_TYPES = [
  'application/vnd.ant.fit',
  'application/fit',
  'application/gpx+xml',
  'application/tcx+xml',
  'application/vnd.garmin.tcx+xml'
]
const FITNESS_MEDIA_TYPE_PATTERN = /(?:^|[./+-])(fit|gpx|tcx)(?:$|[./+-])/i
const FITNESS_FILE_PATH_SEGMENT = '/api/v1/fitness-files/'

export const UploadedAttachment = z.object({
  type: z.literal('upload'),
  id: z.string(),
  mediaType: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  posterUrl: z.string().optional(),
  name: z.string().optional()
})

export type UploadedAttachment = z.infer<typeof UploadedAttachment>

export const PostBoxAttachment = UploadedAttachment.extend({
  isLoading: z.boolean().optional(),
  file: z.custom<File>().optional()
})

export type PostBoxAttachment = z.infer<typeof PostBoxAttachment>

export const Attachment = z.object({
  id: z.string(),
  actorId: z.string(),
  statusId: z.string(),
  type: z.literal('Document'),
  mediaType: z.string(),
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Attachment = z.infer<typeof Attachment>

const getPathnameFromUrl = (value: string) => {
  try {
    return new URL(value, 'https://local.invalid').pathname.toLowerCase()
  } catch {
    return value.toLowerCase().split('?')[0].split('#')[0]
  }
}

const hasFitnessExtension = (value: string) => {
  const lowerValue = value.toLowerCase()
  const pathname = getPathnameFromUrl(value)

  return FITNESS_FILE_EXTENSIONS.some(
    (ext) => lowerValue.endsWith(ext) || pathname.endsWith(ext)
  )
}

export const isFitnessAttachment = (
  attachment: Pick<Attachment, 'mediaType' | 'url' | 'name'>
) => {
  const mediaType = attachment.mediaType.toLowerCase()
  const pathname = getPathnameFromUrl(attachment.url)

  if (
    FITNESS_MEDIA_TYPES.includes(mediaType) ||
    FITNESS_MEDIA_TYPE_PATTERN.test(mediaType)
  ) {
    return true
  }

  if (pathname.includes(FITNESS_FILE_PATH_SEGMENT)) {
    return true
  }

  return (
    hasFitnessExtension(attachment.url) || hasFitnessExtension(attachment.name)
  )
}

export const getDocumentFromAttachment = (attachment: Attachment) =>
  Document.parse({
    type: 'Document',
    mediaType: attachment.mediaType,
    url: attachment.url,
    ...(attachment.width ? { width: attachment.width } : null),
    ...(attachment.height ? { height: attachment.height } : null),
    name: attachment.name
  })

export const getMastodonAttachment = (attachment: Attachment) => {
  if (
    attachment.mediaType.startsWith('image') &&
    attachment.mediaType !== 'image/gif'
  ) {
    return Mastodon.MediaTypes.Image.parse({
      id: attachment.id,
      url: attachment.url,
      preview_url: null,
      remote_url: null,
      description: attachment.name,
      type: 'image',
      meta: {
        original: {
          width: attachment.width ?? 0,
          height: attachment.height ?? 0,
          size: `${attachment.width}x${attachment.height}`,
          aspect: (attachment.width ?? 0) / (attachment.height ?? 1)
        }
      },
      blurhash: null
    })
  }
  if (attachment.mediaType.startsWith('video')) {
    return Mastodon.MediaTypes.Video.parse({
      id: attachment.id,
      url: attachment.url,
      preview_url: null,
      remote_url: null,
      description: attachment.name,
      type: 'video',
      meta: {
        size: `${attachment.width}x${attachment.height}`,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        aspect: (attachment.width ?? 0) / (attachment.height ?? 1),

        original: {
          width: attachment.width ?? 0,
          height: attachment.height ?? 0,
          size: `${attachment.width}x${attachment.height}`,
          aspect: (attachment.width ?? 0) / (attachment.height ?? 1)
        }
      },
      blurhash: null
    })
  }
  return null
}

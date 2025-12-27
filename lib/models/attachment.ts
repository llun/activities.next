import { Document, Mastodon } from '@llun/activities.schema'
import { z } from 'zod'

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

import { Document } from '@llun/activities.schema'
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

export const PostBoxAttachment = UploadedAttachment

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

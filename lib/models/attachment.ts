import { z } from 'zod'

import { Document } from '../activities/entities/document'

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

export const AttachmentData = z.object({
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

export type AttachmentData = z.infer<typeof AttachmentData>

export class Attachment {
  readonly data: AttachmentData

  constructor(params: AttachmentData) {
    this.data = AttachmentData.parse(params)
  }

  toObject() {
    const data = this.data
    const document: Document = {
      type: 'Document',
      mediaType: data.mediaType,
      url: data.url,
      ...(data.width ? { width: data.width } : null),
      ...(data.height ? { height: data.height } : null),
      name: data.name
    }
    return document
  }

  toJson(): AttachmentData {
    return this.data
  }
}

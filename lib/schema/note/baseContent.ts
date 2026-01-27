import { z } from 'zod'

import { Collection } from '../collection'
import { Attachment } from './attachment'
import { Tag } from './tag'

export const BaseContent = z.object({
  id: z.string(),
  url: z.string().describe('Note URL. This is optional for Pleloma').nullish(),
  attributedTo: z.string().describe('Note publisher'),

  to: z.union([z.string(), z.string().array()]),
  cc: z.union([z.string(), z.string().array()]),

  inReplyTo: z.string().nullish(),

  summary: z.string().describe('Note short summary').nullish(),
  summaryMap: z
    .record(z.string(), z.string())
    .describe('Note short summary in each locale')
    .nullish(),

  content: z
    .union([
      z.string().describe('Note content'),
      z.string().describe('Note content in array from Wordpress').array()
    ])
    .nullish(),
  contentMap: z
    .union([
      z.record(z.string(), z.string()).describe('Note content in each locale'),
      z
        .string()
        .describe(
          'Some activity pub server use content map as array with content in the first element'
        )
        .array()
    ])
    .nullish(),
  replies: Collection.nullish(),

  attachment: z.union([Attachment, Attachment.array()]).nullish(),
  tag: z.union([Tag, Tag.array()]),

  published: z.string().describe('Object published datetime'),
  updated: z.string().describe('Object updated datetime').nullish()
})

export type BaseContent = z.infer<typeof BaseContent>

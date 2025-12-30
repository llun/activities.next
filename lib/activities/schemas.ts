import { z } from 'zod'

export const Image = z
  .object({
    type: z.literal('Image'),
    id: z.string(),
    attributedTo: z.string(),
    to: z.union([z.string(), z.string().array()]).optional(),
    cc: z.union([z.string(), z.string().array()]).optional(),
    content: z.string().optional(),
    contentMap: z.record(z.string(), z.string()).optional(),
    summary: z.string().optional(),
    summaryMap: z.record(z.string(), z.string()).optional(),
    url: z.union([z.string(), z.any().array()]).optional(),
    published: z.string(),
    attachment: z.any().optional(),
    tag: z.any().optional(),
    mediaType: z.string().optional(),
    name: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    blurhash: z.string().optional(),
    inReplyTo: z.string().optional()
  })
  .passthrough()

export type Image = z.infer<typeof Image>

export const Page = Image.extend({ type: z.literal('Page') })
export type Page = z.infer<typeof Page>

export const Article = Image.extend({ type: z.literal('Article') })
export type Article = z.infer<typeof Article>

export const Video = Image.extend({ type: z.literal('Video') })
export type Video = z.infer<typeof Video>

import { z } from 'zod'

export const Document = z.object({
  type: z.literal('Document'),
  mediaType: z.string(),
  url: z.string(),
  blurhash: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string().optional().nullable(),
  focalPoint: z.tuple([z.number(), z.number()]).optional()
})

export type Document = z.infer<typeof Document>

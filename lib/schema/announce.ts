import { z } from 'zod'

export const Announce = z.object({
  type: z.literal('Announce'),
  id: z.string(),
  actor: z.string(),

  published: z.string().describe('Object published datetime'),
  to: z.union([z.string(), z.string().array()]),
  cc: z.union([z.string(), z.string().array()]),
  object: z.string()
})
export type Announce = z.infer<typeof Announce>

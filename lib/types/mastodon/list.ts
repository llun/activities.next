// This schema is based on https://docs.joinmastodon.org/entities/List/
import { z } from 'zod'

export const ListEntity = z.object({
  id: z.string().describe('The internal database ID of the list'),
  title: z.string().describe('The user-defined title of the list'),
  replies_policy: z
    .enum(['followed', 'list', 'none'])
    .describe('Which replies should be shown in the list'),
  exclusive: z
    .boolean()
    .describe('Whether members of this list are hidden from the home timeline')
})
export type ListEntity = z.infer<typeof ListEntity>

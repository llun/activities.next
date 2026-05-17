// This schema is base on https://docs.joinmastodon.org/entities/Status/#Tag
import { z } from 'zod'

export const Tag = z.object({
  id: z.string().optional().describe('The normalized hashtag id'),
  name: z.string().describe('The value of the hashtag after the `#` sign'),
  url: z.string().describe('A link to the hashtag on the instance'),
  history: z
    .array(
      z.object({
        day: z.string(),
        uses: z.string(),
        accounts: z.string()
      })
    )
    .optional()
    .describe('Usage history for the hashtag')
})
export type Tag = z.infer<typeof Tag>

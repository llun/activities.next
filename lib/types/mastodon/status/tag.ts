// This schema is based on https://docs.joinmastodon.org/entities/Status/#Tag
import { z } from 'zod'

const TagHistory = z.object({
  day: z.string(),
  uses: z.string(),
  accounts: z.string()
})

export const StatusTag = z.object({
  name: z.string().describe('The value of the hashtag after the `#` sign'),
  url: z.string().describe('A link to the hashtag on the instance')
})
export type StatusTag = z.infer<typeof StatusTag>

export const SearchTag = StatusTag.extend({
  id: z.string().describe('The normalized hashtag id'),
  history: TagHistory.array().describe('Usage history for the hashtag')
})
export type SearchTag = z.infer<typeof SearchTag>

export const Tag = z.union([SearchTag, StatusTag])
export type Tag = z.infer<typeof Tag>

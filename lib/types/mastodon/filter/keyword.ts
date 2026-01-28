// This schema is base on https://docs.joinmastodon.org/entities/FilterKeyword/
import { z } from 'zod'

export const FilterKeyword = z.object({
  id: z.string().describe('The ID of the FilterKeyword in the database'),
  keyword: z.string().describe('The phrase to be matched against'),
  whole_word: z
    .boolean()
    .describe(
      'Should the filter consider word boundaries? See [implementation guidelines for filters](https://docs.joinmastodon.org/api/guidelines/#filters)'
    )
})
export type FilterKeyword = z.infer<typeof FilterKeyword>

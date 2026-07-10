// This schema is base on https://docs.joinmastodon.org/entities/V1_Filter/
import { z } from 'zod'

export const V1Filter = z.object({
  id: z
    .string()
    .describe(
      'The ID of the FilterKeyword in the database. The v1 API addresses individual keywords of v2 filters'
    ),
  phrase: z.string().describe('The text to be filtered'),
  context: z
    .enum(['home', 'notifications', 'public', 'thread', 'account'])
    .array()
    .describe('The contexts in which the filter should be applied'),
  expires_at: z
    .string()
    .describe(
      'When the filter should no longer be applied in ISO 8601 Datetime format or null if the filter does not expire'
    )
    .nullable(),
  irreversible: z
    .boolean()
    .describe(
      'Should matching entities be dropped by the server instead of shown with a warning. Maps to filter_action=hide on the parent v2 filter'
    ),
  whole_word: z
    .boolean()
    .describe('Should the filter consider word boundaries?')
})
export type V1Filter = z.infer<typeof V1Filter>

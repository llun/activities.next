// This schema is base on https://docs.joinmastodon.org/entities/Poll/
import { z } from 'zod'

import { CustomEmoji } from '../customEmoji'
import { Option } from './option'

export const Poll = z.object({
  id: z.string().describe('The ID of the poll in the database'),
  expires_at: z
    .string()
    .describe(
      'The time the poll ends in ISO 8601 datetime or null if the poll does not end'
    )
    .nullable(),
  expired: z.boolean().describe('Whether the poll has expired'),
  multiple: z.boolean().describe('Whether multiple choices are allowed'),
  votes_count: z.number().describe('The number of votes the poll has'),
  voters_count: z.number().describe('The number of actors that voted'),
  options: Option.array().describe('Possible answers for the poll'),
  emojis: CustomEmoji.array().describe(
    'Custom emoji to be used for rendering poll options'
  ),
  voted: z
    .boolean()
    .describe('When called with a user token, has the authorized user voted?')
    .optional(),
  own_votes: z
    .number()
    .array()
    .describe(
      'When called with a user token, which options has the authorized user chosen? Contains an array of index values for `options`'
    )
})
export type Poll = z.infer<typeof Poll>

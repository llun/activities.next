// This schema is base on https://docs.joinmastodon.org/entities/Account/#source
import { z } from 'zod'

import { Visibility } from '@/lib/types/mastodon/visibility'

import { Field } from './field'

export const Source = z.object({
  note: z.string().describe('Profile bio, in plain-text instead of in HTML'),
  fields: Field.array().describe('Metadata about the account'),
  privacy: Visibility.describe(
    'The default post privacy to be used for new statuses.'
  ),
  sensitive: z
    .boolean()
    .describe('Whether new statuses should be marked sensitive by default'),
  language: z
    .string()
    .describe('The default posting language for new statuses'),
  follow_requests_count: z
    .number()
    .describe('The number of pending follow requests')
})
export type Source = z.infer<typeof Source>

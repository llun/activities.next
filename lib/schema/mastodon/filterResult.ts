// This schema is base on https://docs.joinmastodon.org/entities/FilterResult/
import { z } from 'zod'

import { Filter } from './filter/index'

export const FilterResult = z.object({
  filter: Filter.describe('The filter that was matched'),
  keyword_matches: z
    .string()
    .array()
    .nullable()
    .describe('The keyword within the filter that was matched'),
  status_matches: z
    .string()
    .array()
    .nullable()
    .describe('The status ID within the filter that was matched')
})
export type FilterResult = z.infer<typeof FilterResult>

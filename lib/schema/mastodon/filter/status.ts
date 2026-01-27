// This schema is base on https://docs.joinmastodon.org/entities/FilterStatus/
import { z } from 'zod'

export const FilterStatus = z.object({
  id: z.string().describe('The ID of the FilterStatus in the database'),
  status_id: z.string().describe('The ID of the Status that will be filtered')
})
export type FilterStatus = z.infer<typeof FilterStatus>

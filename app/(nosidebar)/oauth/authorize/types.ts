import { z } from 'zod'

export const SearchParams = z.object({
  client_id: z.string(),
  scope: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal('code')
})
export type SearchParams = z.infer<typeof SearchParams>

import { z } from 'zod'

export const PostRequest = z.object({
  client_name: z.string(),
  redirect_uris: z.string(),
  scopes: z.string().optional(),
  website: z.string().optional()
})

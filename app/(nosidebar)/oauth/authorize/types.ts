import { z } from 'zod'

export const SearchParams = z.object({
  client_id: z.string(),
  scope: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal('code'),
  // Signed params from better-auth oauth-provider
  sig: z.string().optional(),
  exp: z.string().optional(),
  // Optional PKCE and state params
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  nonce: z.string().optional(),
  prompt: z.string().optional()
})
export type SearchParams = z.infer<typeof SearchParams>

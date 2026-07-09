import { z } from 'zod'

import { Booleanish } from '@/lib/utils/zodBooleanish'

export const SearchParams = z.object({
  client_id: z.string(),
  // Mastodon defaults a missing scope to `read`
  // (https://docs.joinmastodon.org/methods/oauth/#authorize). Output stays a
  // plain string so consumers can keep calling scope.split(' ').
  scope: z.string().default('read'),
  redirect_uri: z.string(),
  response_type: z.literal('code'),
  // Signed params from better-auth oauth-provider
  sig: z.string().optional(),
  exp: z.string().optional(),
  // Optional PKCE and state params
  state: z.string().optional(),
  request_uri: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  nonce: z.string().optional(),
  prompt: z.string().optional(),
  // Mastodon `force_login`: force the login form even with an active session
  // (needed to authorize a second account from the same browser). Coerced to a
  // boolean; the page strips it before forwarding the OAuth query.
  force_login: Booleanish.optional(),
  // Mastodon `lang`: locale hint for the authorization screen. Accepted for
  // compatibility and intentionally ignored — this consent UI is not
  // localized — and stripped by the page before any query is forwarded.
  lang: z.string().optional()
})
export type SearchParams = z.infer<typeof SearchParams>

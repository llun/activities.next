import { z } from 'zod'

export const PostRequest = z.object({
  client_name: z.string(),
  // Mastodon ≤4.2 sends a single (possibly newline-separated) string; 4.3+
  // clients may send a JSON array of URIs. Accept both; createApplication
  // normalizes to an array.
  redirect_uris: z.union([z.string(), z.string().array()]),
  // Optional OpenID Connect RP-Initiated Logout callbacks. Like `redirect_uris`
  // these are newline-separated. When present (and at least one valid URI is
  // given) the created client gets `enableEndSession = true` so it can drive
  // single logout via `/api/auth/oauth2/end-session`. Omitted ⇒ logout stays
  // disabled (current behavior).
  post_logout_redirect_uris: z.string().optional(),
  scopes: z.string().optional(),
  website: z.string().optional()
})
export type PostRequest = z.infer<typeof PostRequest>

export const SuccessResponse = z.object({
  type: z.literal('success'),
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  scopes: z.string().array(),
  // Deprecated in Mastodon 4.3 but still returned: newline-join of all URIs.
  redirect_uri: z.string(),
  redirect_uris: z.string().array(),
  client_id: z.string(),
  client_secret: z.string(),
  // 0 means the client secret never expires (Mastodon 4.3+).
  client_secret_expires_at: z.literal(0)
})
export type SuccessResponse = z.infer<typeof SuccessResponse>

export const ErrorResponse = z.object({
  type: z.literal('error'),
  error: z.string()
})
export type ErrorResponse = z.infer<typeof ErrorResponse>

export const PostResponse = z.union([SuccessResponse, ErrorResponse])
export type PostResponse = z.infer<typeof PostResponse>

import { z } from 'zod'

// The private keys the server signs atproto OAuth client assertions with
// (`private_key_jwt`). One ES256 private JWK with a `kid`, or a JSON array of
// them while rotating: a PDS ties a session to the key it started with, so an
// old key stays listed until its sessions are gone. Unset, Bluesky sign-in is
// off and only app passwords can link an account.
const PrivateJwk = z
  .object({ kid: z.string().min(1), d: z.string().min(1) })
  .passthrough()

export const BlueskyConfig = z.object({
  oauthPrivateKeys: PrivateJwk.array().min(1)
})
export type BlueskyConfig = z.infer<typeof BlueskyConfig>

export const getBlueskyConfig = (): { bluesky: BlueskyConfig } | null => {
  const raw = process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS?.trim()
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS must be JSON')
  }
  return {
    bluesky: BlueskyConfig.parse({
      oauthPrivateKeys: Array.isArray(parsed) ? parsed : [parsed]
    })
  }
}

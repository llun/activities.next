import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

// The private keys the server signs atproto OAuth client assertions with
// (`private_key_jwt`). One ES256 private JWK with a `kid`, or a JSON array of
// them while rotating: a PDS ties a session to the key it started with, so an
// old key stays listed until its sessions are gone. Unset, Bluesky sign-in is
// off and only app passwords can link an account.
const PrivateJwk = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().min(1),
    y: z.string().min(1),
    d: z.string().min(1),
    kid: z.string().min(1),
    alg: z.literal('ES256').optional()
  })
  // Only these fields reach the key library: the published JWKS is derived
  // from them, and an extra private member (an RSA key's p, q…) would leak.
  .strip()

export const BlueskyConfig = z.object({
  oauthPrivateKeys: PrivateJwk.array().min(1)
})
export type BlueskyConfig = z.infer<typeof BlueskyConfig>

export const getBlueskyConfig = (): { bluesky: BlueskyConfig } | null => {
  const raw = process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS?.trim()
  if (!raw) return null

  // A bad key turns Bluesky sign-in off (app passwords still work) instead of
  // failing the whole config, like the other optional sections.
  try {
    const parsed: unknown = JSON.parse(raw)
    return {
      bluesky: BlueskyConfig.parse({
        oauthPrivateKeys: Array.isArray(parsed) ? parsed : [parsed]
      })
    }
  } catch {
    logger.warn({
      message:
        'ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS must be a private JWK with a kid, or a JSON array of them; Bluesky sign-in will be disabled'
    })
    return null
  }
}

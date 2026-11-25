// Client-safe shape of an actor's linked Bluesky account, as Settings › Other
// networks shows it. Built by lib/services/bluesky/account.ts.

export const BLUESKY_APP_PASSWORD_PATTERN = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i

export interface BlueskyLinkedAccount {
  did: string
  handle: string
  pdsUrl: string
  // hosted: on this server's PDS, managed under "Host my Bluesky account here".
  authType: 'oauth' | 'app_password' | 'hosted'
  domainHandle: boolean
  // False once the PDS refused the stored session: link again to fix it.
  // Always true for a hosted account, which has no session.
  sessionActive: boolean
  // ISO time of the last Home sync that finished; null before the first.
  lastSyncedAt: string | null
  // Why the latest Home sync failed; null once one succeeds.
  syncError: string | null
  // Whether a new public post is cross-posted to Bluesky by default.
  crosspostByDefault: boolean
}

export interface BlueskyAccountState {
  // Bluesky sign-in (OAuth) is configured on this server.
  oauthAvailable: boolean
  account: BlueskyLinkedAccount | null
  // Set for an admin: the served domain this profile lives on, which it may
  // answer /.well-known/atproto-did for, and who holds it now.
  instanceHandle: {
    host: string
    // inactive: this profile's own claim, which counts for nothing now (it
    // is no longer an admin, or lives on another domain); it can be let go.
    // hosted: this profile's own claim, which a Bluesky account hosted on this
    // server overrides; it can be let go.
    status: 'yours' | 'free' | 'taken' | 'inactive' | 'hosted'
  } | null
}

export interface BlueskyHandleCheck {
  handle: string
  // The handle and the DID point at each other (DNS or HTTPS).
  verified: boolean
  // `_atproto.<handle>` holds `did=<did>`; null when DNS could not answer.
  dnsRecord: boolean | null
}

// The TXT record a domain handle needs.
export const getBlueskyDnsRecord = (handle: string, did: string) => ({
  name: `_atproto.${handle}`,
  value: `did=${did}`
})

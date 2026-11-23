// Client-safe shape of an actor's linked Bluesky account, as Settings › Other
// networks shows it. Built by lib/services/bluesky/account.ts.

export const BLUESKY_APP_PASSWORD_PATTERN = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i

export interface BlueskyLinkedAccount {
  did: string
  handle: string
  pdsUrl: string
  authType: 'oauth' | 'app_password'
  domainHandle: boolean
  // False once the PDS refused the stored session: link again to fix it.
  sessionActive: boolean
}

export interface BlueskyAccountState {
  // Bluesky sign-in (OAuth) is configured on this server.
  oauthAvailable: boolean
  account: BlueskyLinkedAccount | null
  // Set for an admin: the server host they may answer
  // /.well-known/atproto-did for, and who holds it now.
  instanceHandle: {
    host: string
    status: 'yours' | 'free' | 'taken'
  } | null
}

export interface BlueskyHandleCheck {
  handle: string
  // The handle and the DID point at each other (DNS or HTTPS).
  verified: boolean
  // `_atproto.<handle>` holds `did=<did>`.
  dnsRecord: boolean
}

// The TXT record a domain handle needs.
export const getBlueskyDnsRecord = (handle: string, did: string) => ({
  name: `_atproto.${handle}`,
  value: `did=${did}`
})

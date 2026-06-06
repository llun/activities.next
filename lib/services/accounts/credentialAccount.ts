import { Mastodon } from '@/lib/types/activitypub'

// Mastodon caps the pending follow-request count surfaced in `source` at 40.
const MAX_FOLLOW_REQUESTS_COUNT = 40

// This service has no roles system, so every local account is reported with the
// default "everyone" role (Mastodon's reserved id -99) and no elevated
// permissions. This keeps verify_credentials/update_credentials shape-compatible
// with clients that expect a `role` object.
export const DEFAULT_ROLE: Mastodon.Role = {
  id: '-99',
  name: '',
  color: '',
  permissions: '0',
  highlighted: false
}

// Overlays the credential-only extras (real follow_requests_count + role) on
// top of a public Account to produce the CredentialAccount returned by
// verify_credentials and update_credentials.
export const buildCredentialAccount = ({
  account,
  followRequestsCount
}: {
  account: Mastodon.Account
  followRequestsCount: number
}): Mastodon.CredentialAccount =>
  Mastodon.CredentialAccount.parse({
    ...account,
    source: {
      ...account.source,
      follow_requests_count: Math.min(
        followRequestsCount,
        MAX_FOLLOW_REQUESTS_COUNT
      )
    },
    role: DEFAULT_ROLE
  })

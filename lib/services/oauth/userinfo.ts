import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

export interface UserInfoBase {
  iss: string
  sub: string
}

export interface UserInfoProfile {
  name: string
  preferred_username: string
  picture: string
  profile: string
}

export interface UserInfoEmail {
  email: string
  email_verified: boolean
}

export type UserInfo = UserInfoBase &
  Partial<UserInfoProfile> &
  Partial<UserInfoEmail>

interface GetUserInfoOptions {
  actor: Actor
  account: Account
  issuer: string
  scopes?: string[]
}

export const getUserInfo = ({
  actor,
  account,
  issuer,
  scopes
}: GetUserInfoOptions): UserInfo => {
  const includeProfile =
    !scopes || scopes.includes('profile') || scopes.includes('read')
  const includeEmail = !scopes || scopes.includes('email')
  const email = account.email

  return {
    // The issuer this response was produced by — the same
    // `${baseURL}${AUTH_BASE_PATH}` the OpenID discovery document advertises
    // and better-auth stamps as the id_token `iss`. Mastodon 4.3+ also
    // returns `iss` from /oauth/userinfo.
    iss: issuer,
    // OIDC §5.3.2 requires the userinfo `sub` to equal the id_token `sub`. Better
    // Auth signs the id_token with `sub = account id` (the user record id), so the
    // canonical subject here is the owning account id — one OIDC subject per human,
    // regardless of how many ActivityPub actors that account owns. This is an
    // intentional divergence from Mastodon (which returns the account URL as
    // `sub`): changing it would break every relying party that stored the
    // id_token `sub`. Profile fields below stay actor-sourced (the actor
    // selected for this session/token).
    sub: account.id,
    ...(includeProfile && {
      // Mastodon always returns name/picture from /oauth/userinfo; fall back
      // to empty strings instead of omitting the claims when the actor has
      // none.
      name: actor.name ?? '',
      preferred_username: actor.username,
      picture: actor.iconUrl ?? '',
      profile: actor.id
    }),
    ...(includeEmail && email != null
      ? {
          email,
          // `emailVerified`, NOT `verifiedAt`. `accounts.verifiedAt` carries
          // DEFAULT CURRENT_TIMESTAMP, so it is non-null for every account ever
          // written and asserts nothing — the same defect that made
          // `canCreateSessionForAccount`'s check a no-op for as long as that
          // helper has existed. (The COLUMN dates to 2023; the helper is
          // recent. Do not reattach an age to the helper — that claim was
          // corrected once in this series and then rewritten here from memory.)
          // This is the last surface that trusted it, and it disagreed with the
          // id_token (`lib/services/auth/auth.ts`) and better-auth's own
          // userinfo, both of which read `emailVerified`. Three claims about
          // one fact now come from one column.
          email_verified: account.emailVerified
        }
      : {})
  }
}

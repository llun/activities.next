import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

export interface UserInfoBase {
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
  scopes?: string[]
}

export const getUserInfo = ({
  actor,
  account,
  scopes
}: GetUserInfoOptions): UserInfo => {
  const includeProfile =
    !scopes || scopes.includes('profile') || scopes.includes('read')
  const includeEmail = !scopes || scopes.includes('email')
  const email = account.email

  return {
    // OIDC §5.3.2 requires the userinfo `sub` to equal the id_token `sub`. Better
    // Auth signs the id_token with `sub = account id` (the user record id), so the
    // canonical subject here is the owning account id — one OIDC subject per human,
    // regardless of how many ActivityPub actors that account owns. Profile fields
    // below stay actor-sourced (the actor selected for this session/token).
    sub: account.id,
    ...(includeProfile && {
      ...(actor.name != null ? { name: actor.name } : {}),
      preferred_username: actor.username,
      ...(actor.iconUrl != null ? { picture: actor.iconUrl } : {}),
      profile: actor.id
    }),
    ...(includeEmail && email != null
      ? {
          email,
          email_verified:
            account.verifiedAt != null || account.emailVerifiedAt != null
        }
      : {})
  }
}

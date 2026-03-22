import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { urlToId } from '@/lib/utils/urlToId'

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
  account?: Account | null
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
  const email = account?.email

  return {
    sub: urlToId(actor.id),
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
            account?.verifiedAt != null || account?.emailVerifiedAt != null
        }
      : {})
  }
}

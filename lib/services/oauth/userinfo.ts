import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { urlToId } from '@/lib/utils/urlToId'

export interface UserInfoBase {
  sub: string
}

export interface UserInfoProfile {
  name: string | null
  preferred_username: string
  picture: string | null
  profile: string
}

export interface UserInfoEmail {
  email: string | null
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
  const result: UserInfo = {
    sub: urlToId(actor.id)
  }

  // Include profile claims when profile or read scope is granted,
  // or when no scopes are provided (legacy/session-based access)
  if (!scopes || scopes.includes('profile') || scopes.includes('read')) {
    result.name = actor.name ?? null
    result.preferred_username = actor.username
    result.picture = actor.iconUrl ?? null
    result.profile = actor.id
  }

  // Include email claims only when email scope is granted
  if (!scopes || scopes.includes('email')) {
    result.email = account?.email ?? null
    result.email_verified = account?.emailVerifiedAt != null
  }

  return result
}

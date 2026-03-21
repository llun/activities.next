import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { urlToId } from '@/lib/utils/urlToId'

export interface UserInfo {
  sub: string
  name: string | null
  preferred_username: string
  picture: string | null
  profile: string
  email: string | null
  email_verified: boolean
}

export const getUserInfo = (
  actor: Actor,
  account?: Account | null
): UserInfo => {
  return {
    sub: urlToId(actor.id),
    name: actor.name ?? null,
    preferred_username: actor.username,
    picture: actor.iconUrl ?? null,
    profile: actor.id,
    email: account?.email ?? null,
    email_verified: account?.emailVerifiedAt != null
  }
}

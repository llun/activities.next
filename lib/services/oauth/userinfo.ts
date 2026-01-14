import { Actor } from '@/lib/models/actor'
import { urlToId } from '@/lib/utils/urlToId'

export interface UserInfo {
  sub: string
  name: string | null
  preferred_username: string
  picture: string | null
  profile: string
}

export const getUserInfo = (actor: Actor): UserInfo => {
  return {
    sub: urlToId(actor.id),
    name: actor.name ?? null,
    preferred_username: actor.username,
    picture: actor.iconUrl ?? null,
    profile: actor.id
  }
}

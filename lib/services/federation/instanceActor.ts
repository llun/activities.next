import { type Actor } from '@/lib/types/domain/actor'
import { getLocalActorId } from '@/lib/utils/activitypubId'

export const FEDERATION_SIGNING_ACTOR_USERNAME = '__instance__'
export const FEDERATION_SIGNING_ACTOR_TYPE = 'Service'

export const getFederationSigningActorUsername = (index = 0) =>
  index === 0 ? FEDERATION_SIGNING_ACTOR_USERNAME : `__instance__${index}`

export const isFederationSigningActorUsername = (username: string) =>
  username.startsWith(FEDERATION_SIGNING_ACTOR_USERNAME)

export const getFederationSigningActorId = (
  domain: string,
  username = FEDERATION_SIGNING_ACTOR_USERNAME
) => getLocalActorId({ domain, username })

export const isFederationSigningActor = (actor?: Actor | null) =>
  Boolean(
    actor?.privateKey &&
    actor.type === FEDERATION_SIGNING_ACTOR_TYPE &&
    isFederationSigningActorUsername(actor.username) &&
    !actor.account
  )

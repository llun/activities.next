import { type Actor } from '@/lib/types/domain/actor'
import { getLocalActorId } from '@/lib/utils/activitypubId'

export const FEDERATION_SIGNING_ACTOR_USERNAME = '__instance__'
export const FEDERATION_SIGNING_ACTOR_TYPE = 'Service'

export const getFederationSigningActorUsername = (index = 0) =>
  index === 0 ? FEDERATION_SIGNING_ACTOR_USERNAME : `__instance__${index}`

// Deliberately LOOSE: reserves the whole `__instance__` prefix at MINT time, so
// no new account can take a name confusable with the instance actor's. Safe for
// its other callers because each pairs it with `accountId == null`.
export const isFederationSigningActorUsername = (username: string) =>
  username.startsWith(FEDERATION_SIGNING_ACTOR_USERNAME)

// The usernames `getFederationSigningActorUsername` can actually mint, and so
// the ONLY ones whose URI can ever be a federation-signing-actor id.
//
// Split from the loose form above because the two answer different questions
// and one call site needs this one. `OnlyLocalUserGuard` asks "may a non-signing
// actor answer at this URI", and the prefix test over-answers it: a legacy
// account named `__instance__archive` — registerable before the reserved-name
// refine landed in #612, when the username schema was an unanchored `/\w+/`
// with no reserved check — owns an id `getFederationSigningActorId` cannot
// produce at any index, yet a `startsWith` guard 404s its actor document,
// inbox (so remote deliveries fail), outbox, followers, following, collections
// and every already-federated status dereference. Silently, with no migration.
export const isFederationSigningActorIdUsername = (username: string) =>
  /^__instance__\d*$/.test(username)

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

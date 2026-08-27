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

// Exactly the usernames `getFederationSigningActorUsername` can MINT: bare
// `__instance__` for index 0, then `__instance__<n>` for integer n >= 1. The
// index is an interpolated JS number, so it never carries a leading zero —
// hence `[1-9]\d*` and not `\d*`, which would also match `__instance__0`,
// `__instance__00` and `__instance__007`, none of which the minter can produce.
//
// Split from the loose form above because the two answer different questions,
// and `OnlyLocalUserGuard` needs this one. It asks "may an account-owning actor
// answer at a URI this instance may itself mint a signer on", and the prefix
// test over-answers it: a legacy account named `__instance__archive` —
// registerable before the reserved-name refine landed in #612, when the
// username schema was an unanchored `/\w+/` with no reserved check — owns an
// id `getFederationSigningActorId` cannot produce at any index, yet a
// `startsWith` guard 404s its actor document, inbox (so remote deliveries
// fail), outbox, followers, following, collections and every already-federated
// status dereference. Silently, with no migration.
//
// **These two predicates are NOT interchangeable and must not be unified.**
// This one is deliberately NOT "every id that can ever be a signing actor" —
// that set is larger. `getExistingHeadlessActor` ADOPTS any pre-existing
// headless Service row matching `__instance__%` with a null `accountId`, and
// validates it with the LOOSE predicate, so an instance can legitimately sign
// as `__instance__archive`. Narrowing `isValidFederationSigningSQLActor` or
// `isFederationSigningActor` onto this form would stop such an adopted signer
// validating at all — silently ending federation signing on that instance. The
// guard stays correct across that split because an adopted signer's name is
// outside THIS predicate, so its reserved-name test simply does not fire. See
// `OnlyLocalUserGuard` for which of its checks carries which case; do not
// restate that reasoning here, and do not assume either check is redundant with
// the other — both are required to serve the genuine signer.
export const isFederationSigningActorIdUsername = (username: string) =>
  /^__instance__([1-9]\d*)?$/.test(username)

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

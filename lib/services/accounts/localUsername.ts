import { z } from 'zod'

import { isFederationSigningActorUsername } from '@/lib/services/federation/instanceActor'

// A local username becomes a path segment of the actor's canonical id —
// `getLocalActorId` builds `https://${domain}/users/${username}` and does not
// encode it — so the charset it may draw from is a correctness rule, not a
// cosmetic one.
//
// What made this load-bearing: the creation schemas used to accept `%` (one was
// an UNANCHORED `/\w+/`, the other had no charset check at all), and a path
// segment is percent-DECODED on the way back in. So `%6eull` could be
// registered, stored and federated as `https://<domain>/users/%6eull`, and
// dereferencing that id decoded the segment to `null` and served whichever
// actor owns THAT name — their Person document, their public key, their outbox
// and followers — under a URI belonging to someone else. `nul%6c` and `%6Eull`
// do the same, and `a%2Fb` decodes to a different path entirely. On an instance
// whose owner is genuinely named `null` that is not a hypothetical.
//
// Deliberately NOT shared with the `USERNAME_PATTERN` in
// `getFallbackBlockedAccount`/`getFallbackMutedAccount`: those decide whether a
// REMOTE actor id's last segment is safe to SHOW as a username. A remote server
// may legitimately mint names this instance would refuse, so the two rules only
// look alike — tying them together would let a change to one silently move the
// other.
export const LOCAL_USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/

// The limit `POST /api/v1/actors` already carried. Registration had NONE, so
// sharing one schema newly bounds it — a deliberate tightening, not a preserved
// rule: `actors.username` is `varchar(255)`, so a longer name was storable but
// a 256-character one overflowed the column and 500'd on PostgreSQL rather than
// being refused. An instance already holding a longer username keeps it; this
// is checked only when a name is minted.
export const LOCAL_USERNAME_MAX_LENGTH = 50

/**
 * The one rule for a username this instance mints, so the two creation paths
 * cannot drift apart. `POST /api/v1/accounts` (registration) and
 * `POST /api/v1/actors` (an additional actor for a signed-in account) both
 * compose it.
 *
 * Length and charset are separate checks so the limit stays readable rather
 * than being buried in a quantifier.
 */
export const localUsernameSchema = z
  .string()
  .trim()
  // Lowercased rather than refused, so `Alice` registers as `alice` instead of
  // becoming a second actor indistinguishable from `alice` to every
  // case-insensitive client. The pattern below still names `A-Z` because it
  // describes what a caller may SEND; by the time it runs there is none left.
  //
  // Folding before the reserved-name refine is load-bearing:
  // `isFederationSigningActorUsername` is a case-sensitive
  // `startsWith('__instance__')`, so `__INSTANCE__` passed the check and minted
  // a confusable neighbour of the instance actor. (`OnlyLocalUserGuard` refuses
  // such a legacy row at that URI; this is what stops new ones.)
  //
  // Sitting before `.max()` is defensive only, NOT load-bearing — an earlier
  // version of this comment claimed otherwise. A fold can lengthen a string,
  // but the only mapping that does is `İ` -> `i` + U+0307, and U+0307 is not in
  // `LOCAL_USERNAME_PATTERN`, so the regex refuses any such input wherever
  // `.max()` sits; ASCII folding is length-preserving.
  //
  // This fold is Zod's own `.trim().toLowerCase()` rather than a call to
  // `normalizeUsername`, mirroring how the email schemas relate to
  // `normalizeEmail`. That makes it a SECOND spelling of the mint-time rule, so
  // `localUsername.test.ts` pins the two against each other.
  .toLowerCase()
  .min(1)
  .max(LOCAL_USERNAME_MAX_LENGTH)
  .regex(LOCAL_USERNAME_PATTERN, {
    message:
      'Username may only contain letters, numbers, underscore, dot and dash, and must start with a letter, number or underscore'
  })
  .refine((username) => !isFederationSigningActorUsername(username), {
    message: 'Username is reserved'
  })

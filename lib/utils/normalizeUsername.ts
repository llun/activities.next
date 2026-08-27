/**
 * Canonicalizes a local username this instance MINTS.
 *
 * A local actor's id is `https://<domain>/users/<username>`, so the username is
 * the identity rather than a label on it: storing this form is what stops
 * `Alice` and `alice` becoming two actors with two ActivityPub ids.
 *
 * Normalization is intentionally minimal — trim then lowercase — matching
 * `normalizeEmail`: enough to make casing irrelevant, not so much that the name
 * stops being the one the user chose.
 *
 * **This is a MINT-side primitive, and unlike `normalizeEmail` it is NOT what
 * every touchpoint routes through.** Do not copy that framing across:
 *
 *  - LOOKUP does not use it. `findActorRowByUsername` folds with a bare
 *    `toLowerCase()`, because the trim here would compare a trimmed input
 *    against an untrimmed `lower(username)` — see the comment there.
 *  - The request schema does not call it either; `localUsernameSchema` spells
 *    the same rule as a Zod `.trim().toLowerCase()` chain, and
 *    `localUsername.test.ts` pins the two against each other.
 *
 * And it has exactly one caller that is neither a mint nor a lookup:
 * `OnlyLocalUserGuard` folds the requested path segment with it before asking
 * `isFederationSigningActorIdUsername` whether that segment names the instance
 * actor's URI. That is an ACCESS-CONTROL decision, so a rule added here changes
 * it. The standing example makes that concrete: teach this function to strip a
 * trailing dot and `__instance__.` starts folding to `__instance__`, changing
 * which requests are treated as addressing the reserved slot.
 *
 * So the callers are: two mint paths, one reserved-name check, and nothing
 * else. A new rule reaches those three and does NOT propagate to the lookup or
 * the schema — updating those is deliberate work, not inheritance. Enumerate
 * the call sites before changing this; do not trust a summary of them,
 * including this one.
 */
export const normalizeUsername = (username: string): string =>
  username.trim().toLowerCase()

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
 * So a new rule added here (the standing example is stripping a trailing dot)
 * reaches the mint paths and NOTHING else. That is the mint/lookup split this
 * whole feature exists to close, so adding one means updating the fold in
 * `findActorRowByUsername` and the schema deliberately, not by inheritance.
 */
export const normalizeUsername = (username: string): string =>
  username.trim().toLowerCase()

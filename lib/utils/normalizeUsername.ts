/**
 * Canonicalizes a username for minting and comparison.
 *
 * Two separate jobs, deliberately one function so they cannot disagree:
 *
 *  - Every local username this instance MINTS is stored in this form, so
 *    `Alice` and `alice` can never become two actors with two ActivityPub ids.
 *    A local actor's id is `https://<domain>/users/<username>`, so the username
 *    is the identity, not a label on it.
 *  - Every username LOOKUP folds through it, so a handle typed, mentioned or
 *    WebFingered in any casing reaches the same actor.
 *
 * Normalization is intentionally minimal — trim then lowercase — matching
 * `normalizeEmail`: enough to make casing irrelevant, not so much that the
 * name stops being the one the user chose.
 *
 * Note this is Unicode-aware where SQL `lower()` may not be: SQLite's builtin
 * folds ASCII only. That asymmetry is why `findActorRowByUsername` tries an
 * exact match BEFORE folding — see the comment there.
 */
export const normalizeUsername = (username: string): string =>
  username.trim().toLowerCase()

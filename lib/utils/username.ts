// A remote actor's username is chosen by a server we do not control, and it is
// later spliced into `/@user@domain` paths, `acct:` URIs, mentions and CSV
// exports. Mastodon refuses to store a remote account whose username is not
// `Account::USERNAME_ONLY_RE` (`/\A[a-z0-9_]+([.-]+[a-z0-9_]+)*\z/i`) or is
// longer than `USERNAME_LENGTH_HARD_LIMIT`; this is the same rule, so a
// username can never start with `=`, `+`, `-` or `@` (spreadsheet formulas) or
// contain whitespace, `/`, `:`, `?` or `#`.
//
// Ruby's `/i` also folds a few non-ASCII letters onto ASCII ones (U+017F,
// U+212A); the class below is ASCII-only, so those are refused here.

// Mastodon's USERNAME_LENGTH_HARD_LIMIT is 2048, but `actors.username` is
// varchar(255) here and a longer value would fail the insert on PostgreSQL, so
// the effective limit is the smaller of the two.
export const MASTODON_USERNAME_LENGTH_HARD_LIMIT = 2048
export const USERNAME_COLUMN_LENGTH = 255
export const REMOTE_USERNAME_HARD_LIMIT = Math.min(
  MASTODON_USERNAME_LENGTH_HARD_LIMIT,
  USERNAME_COLUMN_LENGTH
)

const REMOTE_USERNAME_PATTERN = /^[a-zA-Z0-9_]+(?:[.-]+[a-zA-Z0-9_]+)*$/

// Mastodon's `normalizes :username, with: squish`: trim and collapse runs of
// whitespace, before the format check. Rails squishes `[[:space:]]`, which is
// JS `\s` plus U+0085 (NEL) but not U+FEFF (JS `\s` includes the BOM, Ruby's
// does not), so the BOM is excluded.
const SQUISH_SPACE = /(?:(?!\uFEFF)[\s\u0085])+/g

export const squishUsername = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(SQUISH_SPACE, ' ').replace(/^ | $/g, '')
    : ''

export const isValidRemoteUsername = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.length <= REMOTE_USERNAME_HARD_LIMIT &&
  REMOTE_USERNAME_PATTERN.test(value)

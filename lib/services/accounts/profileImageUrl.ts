import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { HostRuleConfig } from '@/lib/utils/host'

/**
 * `accounts.iconUrl` is `varchar(255)` on both backends, so a longer value is a
 * PostgreSQL insert failure rather than a validation result. The actor's own
 * icon lives in the `actors.settings` JSON and has no column limit, but both
 * routes share the cap so one rule describes both. A real media URL is nowhere
 * near it: a stored file is named from 8 random bytes, so the whole URL runs
 * about a hundred characters.
 */
export const MAX_PROFILE_IMAGE_URL_LENGTH = 255

export type ProfileImageUrlResult =
  | {
      valid: true
      /**
       * Mirrors `UpdateActorParams['iconUrl']`: a string to store, `null` to
       * clear the stored image, and `undefined` to leave it unchanged.
       */
      value: string | null | undefined
    }
  | { valid: false }

const REFUSED: ProfileImageUrlResult = { valid: false }

type SubmissionOutcome = 'unchanged' | 'clear' | 'candidate'

/**
 * What a non-null submission is asking for, before any of it is validated.
 *
 * `unchanged` skips validation deliberately: a client echoing back the value
 * already stored is not proposing a new one, which is the "existing rows are
 * left alone" rule this module's contract states, enforced at the one place a
 * stored value comes back in. It gives nothing away — a value that differs at
 * all takes the `candidate` path and has to pass every check, and an empty
 * submission still clears — so a stale row stays removable rather than sticky.
 *
 * That matters because `/settings` is a SINGLE form around name, summary, both
 * images and the privacy switch, and `ImageUploadField` seeds its hidden input
 * from the stored URL and resubmits it untouched. Re-validating it would 422
 * the WHOLE form for an actor carrying a URL stored before this rule existed —
 * which the field's old `https://example.com/avatar.jpg` placeholder actively
 * invited — losing an unrelated name edit to a bare JSON body with no error UI.
 *
 * **The three tests must run in exactly this order.** Each guards a case the
 * other two collide on, because a legacy stored value can be nothing but
 * whitespace — truthy, yet trimming to the same `''` an empty submission does:
 *
 * 1. An EXACT echo, compared before anything is trimmed. An untouched field
 *    submits the stored value byte for byte; Remove submits `''` exactly. Trim
 *    first and those two become indistinguishable, and a save that never
 *    touched the image writes `null` over such a row.
 * 2. Then an empty submission, which is ALWAYS a clear. Order it after the
 *    trimmed match and that match swallows Remove, leaving the only control
 *    that can clear such a row a silent no-op — the field is read-only, and
 *    nothing else writes it.
 * 3. Then a trimmed match, so incidental whitespace on either side still counts
 *    as an echo. Everything this validator stores is trimmed, but the rows it
 *    protects predate it and nothing on the read path trims, so a copy-paste
 *    that carried a space is stored and resubmitted with it.
 *
 * Any other whitespace-only submission — a tab, a newline, a different run of
 * spaces — is not a provable echo and clears, which is the conservative
 * reading.
 */
const classifySubmission = (
  value: string,
  trimmed: string,
  currentValue?: string | null
): SubmissionOutcome => {
  if (currentValue && value === currentValue) return 'unchanged'
  if (trimmed === '') return 'clear'
  if (currentValue && trimmed === currentValue.trim()) return 'unchanged'
  return 'candidate'
}

/**
 * The value to store for a profile image URL a client submitted, or a refusal.
 *
 * Shared by `POST /api/v1/accounts/profile` (the actor's avatar and header) and
 * `POST /api/v1/accounts/image` (the account avatar), so both answer the same
 * question. Both fields were plain `z.string()` before this: any signed-in user
 * could point their avatar at an arbitrary host, which then became a tracking
 * pixel for every viewer of their profile and — for the actor's icon —
 * republished to every instance that fetches the actor.
 *
 * Only a URL SHAPED like one this instance serves its own media from is
 * accepted — our own host, under `/api/v1/files/`, no traversal. It is a check
 * on the host and path, NOT a lookup: nothing confirms a file exists at that
 * path, so a well-formed URL naming nothing still validates. That is enough for
 * what this closes, which is the URL pointing somewhere we do not control. It is
 * also what the upload button in `ImageUploadField` produces, and what
 * `update_credentials` produces from an uploaded file, so it is what every
 * legitimate client already sends.
 *
 * Note `z.url()` is NOT this check and does not stand in for it: in Zod 4 it
 * accepts `javascript:`, `data:` and `file:` URLs, so shape validation alone
 * leaves the schemes worth refusing. The protocol allowlist here has to run
 * BEFORE the host check for the same reason `getProductUrlHostname` needs one —
 * `new URL` parses an authority for non-special schemes too, so
 * `javascript://llun.test/%0aalert(1)` presents a perfectly good hostname.
 *
 * Existing rows are not re-validated. A remote actor's `iconUrl` is written
 * from its actor document by `getPersistableProfile` and is legitimately
 * remote, so this is an input-time rule for local actors, never a render-time
 * one.
 */
export const parseProfileImageUrl = (
  value: string | null | undefined,
  config: HostRuleConfig,
  currentValue?: string | null
): ProfileImageUrlResult => {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }

  const trimmed = value.trim()

  const outcome = classifySubmission(value, trimmed, currentValue)
  if (outcome === 'unchanged') return { valid: true, value: undefined }
  if (outcome === 'clear') return { valid: true, value: null }

  if (trimmed.length > MAX_PROFILE_IMAGE_URL_LENGTH) return REFUSED

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return REFUSED
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return REFUSED
  }

  // Answers the host question with `isOwnInstanceHost` (so a multi-domain
  // instance's alias hosts count) and refuses a path that escapes the media
  // root. A host-relative URL never reaches here — `new URL` above rejects it —
  // which is deliberate: the value is federated as `icon.url`, where a relative
  // reference names the reader's origin rather than ours.
  if (!getMediaPathFromFileUrl(trimmed, config)) return REFUSED

  return { valid: true, value: trimmed }
}

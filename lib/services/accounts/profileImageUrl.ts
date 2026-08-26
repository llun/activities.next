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
 * Only a URL naming media THIS instance already stores is accepted. That is
 * what the upload button in `ImageUploadField` produces, and what
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

  // A client echoing back the value already stored is not proposing a new one,
  // so it is not re-validated — the same "existing rows are left alone" rule
  // this module's contract states, enforced at the one place a stored value
  // comes back in.
  //
  // This is load-bearing, not an optimisation. `/settings` is a SINGLE form
  // around name, summary, both images and the privacy switch, and
  // `ImageUploadField` seeds its hidden input from the stored URL and
  // resubmits it untouched. An actor carrying a URL stored before this rule
  // existed — which the field's old `https://example.com/avatar.jpg`
  // placeholder actively invited — would otherwise 422 the WHOLE form while
  // editing only their display name, losing that edit to a bare JSON body with
  // no error UI, and with no way to save anything on the page again until they
  // worked out that the image had to be removed first.
  //
  // It gives away nothing: a NEW value still has to pass, and clearing still
  // works, so the stale value stays reachable and removable rather than sticky.
  // Both sides are trimmed. Everything this validator STORES is already
  // trimmed, but the values it is protecting predate it: the old field was a
  // free-text box parsed by a bare `z.string()`, and nothing on the read path
  // trims either, so a copy-paste that carried a trailing space is stored and
  // resubmitted with it. Comparing a trimmed submission against a raw stored
  // value missed exactly those rows and left them bricking the form.
  if (currentValue && trimmed === currentValue.trim()) {
    return { valid: true, value: undefined }
  }

  if (trimmed === '') return { valid: true, value: null }

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

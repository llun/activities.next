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
  config: HostRuleConfig
): ProfileImageUrlResult => {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }

  const trimmed = value.trim()
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

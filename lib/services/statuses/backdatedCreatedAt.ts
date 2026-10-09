import { z } from 'zod'

// Activities.next extension to POST /api/v1/statuses: an optional `created_at`
// backdates an immediately-published status (for example a photo album posted
// at the end of the real-life event it records). Mastodon has no equivalent.

// A client clock running slightly ahead of ours must not turn "now" into a
// rejection, but anything further ahead is a future date, not skew.
export const MAX_CREATED_AT_CLOCK_SKEW_MS = 60 * 1000

export const CREATED_AT_INVALID_ERROR =
  'Validation failed: Created at must be an ISO 8601 date-time with a time zone'
export const CREATED_AT_IN_FUTURE_ERROR =
  'Validation failed: Created at must not be in the future'
export const CREATED_AT_WITH_SCHEDULED_AT_ERROR =
  'Validation failed: Created at cannot be combined with scheduled at'

// An explicit offset (or `Z`) is required: a zone-less local time would be
// read in the server's zone, which the client cannot know.
const CreatedAtSchema = z.iso.datetime({ offset: true })

export type BackdatedCreatedAtResult =
  { ok: true; createdAt: number | undefined } | { ok: false; error: string }

// Parses the request's `created_at`. A missing or blank value means "now"
// (`createdAt: undefined`), matching how a blank `scheduled_at` is treated.
// The status's publicId is a UUIDv7 minted from this time, which cannot encode
// a time before the Unix epoch, so those are rejected as invalid too.
export const parseBackdatedCreatedAt = (
  input: string | undefined,
  now: number
): BackdatedCreatedAtResult => {
  const value = input?.trim()
  if (!value) return { ok: true, createdAt: undefined }

  const parsed = CreatedAtSchema.safeParse(value)
  const createdAt = parsed.success ? Date.parse(parsed.data) : Number.NaN
  if (!Number.isFinite(createdAt) || createdAt < 0) {
    return { ok: false, error: CREATED_AT_INVALID_ERROR }
  }
  if (createdAt > now + MAX_CREATED_AT_CLOCK_SKEW_MS) {
    return { ok: false, error: CREATED_AT_IN_FUTURE_ERROR }
  }
  return { ok: true, createdAt }
}

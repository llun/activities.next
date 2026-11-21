import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'

// Strava's API answers in well under a second and its JSON payloads are small.
// The deadline bounds a stalled connection; the cap stops a broken or hostile
// response from being buffered without limit.
export const STRAVA_REQUEST_TIMEOUT_MS = 15_000

// The default cap for the small endpoints (token, athlete, subscriptions,
// uploads, photos, error bodies).
export const STRAVA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

// The streams endpoint returns eleven full-resolution series. At one sample
// per second a long activity (7-8+ hours) is already over the default cap, and
// a 24-hour ultra is several times it, so the cap has to scale with the
// activity rather than the endpoint's usual size.
export const STRAVA_MAX_STREAMS_RESPONSE_BYTES = 64 * 1024 * 1024

// Activity detail embeds `segment_efforts`, `splits_metric`, `laps` and
// `best_efforts`, which grow with the number of segments a long ride covers.
export const STRAVA_MAX_ACTIVITY_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * `fetch` for Strava's fixed hosts, with a deadline on every request. Callers
 * read the body through `readStravaBody`/`readStravaJson` so the byte cap
 * applies too.
 */
export const stravaFetch = (url: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(STRAVA_REQUEST_TIMEOUT_MS)
  })

export const readStravaBody = async (
  response: Response,
  label: string,
  maxBytes = STRAVA_MAX_RESPONSE_BYTES
) =>
  Buffer.from(
    await readResponseArrayBufferWithLimit(response, maxBytes, label)
  ).toString('utf8')

export const readStravaJson = async <T>(
  response: Response,
  label: string,
  maxBytes = STRAVA_MAX_RESPONSE_BYTES
): Promise<T> =>
  JSON.parse(await readStravaBody(response, label, maxBytes)) as T

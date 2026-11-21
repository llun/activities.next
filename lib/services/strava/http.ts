import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'

// Strava's API answers in well under a second and its JSON payloads are small.
// The deadline bounds a stalled connection; the cap stops a broken or hostile
// response from being buffered without limit.
export const STRAVA_REQUEST_TIMEOUT_MS = 15_000
export const STRAVA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

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

export const readStravaBody = async (response: Response, label: string) =>
  Buffer.from(
    await readResponseArrayBufferWithLimit(
      response,
      STRAVA_MAX_RESPONSE_BYTES,
      label
    )
  ).toString('utf8')

export const readStravaJson = async <T>(
  response: Response,
  label: string
): Promise<T> => JSON.parse(await readStravaBody(response, label)) as T

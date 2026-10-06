import { parseAcceptContentTypes } from '@/lib/utils/acceptContentTypes'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import { logger } from '@/lib/utils/logger'
import type { RequestResult } from '@/lib/utils/request'

// The two media types the ActivityPub spec names for an object, and the only
// two Mastodon accepts since CVE-2024-23832 — any server Mastodon federates
// with already serves one of them. `application/ld+json` counts only with the
// ActivityStreams profile: a bare JSON-LD document is not an ActivityPub one.
export const isActivityPubContentType = (contentType: string | undefined) => {
  if (!contentType) return false
  const [mediaType, ...rest] = parseAcceptContentTypes(contentType)
  if (!mediaType || rest.length > 0) return false
  if (mediaType.type === 'application/activity+json') return true
  if (mediaType.type !== 'application/ld+json') return false
  const profile = mediaType.parameters.profile
  return Boolean(profile?.trim().split(/\s+/).includes(ACTIVITY_STREAM_URL))
}

// Whether a fetched response may be read as an ActivityPub document. The
// Content-Type is the one thing a user upload cannot choose: a Pleroma/Akkoma
// media URL on an instance's own domain serves attacker-written JSON from the
// origin every same-origin check trusts, but as `application/json` or
// `application/octet-stream`. Reading it anyway is how a JSON upload minted an
// actor (its own key and inbox) or a note on someone else's instance. Every
// ActivityPub GET goes through this instead of a bare `statusCode === 200`.
export const isActivityPubDocumentResponse = (
  response: Pick<RequestResult, 'statusCode' | 'headers' | 'url'>,
  requestedUrl: string
) => {
  if (response.statusCode !== 200) return false
  const contentType = getHeaderValue(response.headers, 'content-type')
  if (isActivityPubContentType(contentType)) return true
  logger.warn({
    message: 'Refused remote document served without an ActivityPub type',
    url: requestedUrl,
    servedFrom: response.url ?? requestedUrl,
    contentType: contentType ?? null
  })
  return false
}

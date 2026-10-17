import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import packageJson from '@/package.json'

import { hasRelMeLinkTo } from './html'

// Mastodon reads the page for a few seconds; a profile link is a small static
// page, so a slow or huge one is simply "not verified". The timeouts apply to
// each redirect hop, so a link with two redirects can take about 30 s.
export const PROFILE_LINK_CONNECT_TIMEOUT_MS = 5_000
export const PROFILE_LINK_READ_TIMEOUT_MS = 5_000
export const PROFILE_LINK_MAX_BODY_BYTES = 1024 * 1024
export const PROFILE_LINK_MAX_REDIRECTS = 2

const ACCEPTED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

const USER_AGENT = `activities.next/${packageJson.version} (+https://github.com/llun/activities.next; profile link verification)`

/**
 * Whether the page at `url` links back to the profile with rel="me": the check
 * Mastodon's VerifyLinkService makes. Every failure (the SSRF guard refusing
 * the address, a timeout, a non-200 answer, a non-HTML type, a body over the
 * cap) is just "not verified". Redirects of the page itself are followed (up
 * to two hops, all through the same guard); the link back is compared
 * literally and is never resolved.
 */
export const verifyProfileLink = async ({
  url,
  linkBacks
}: {
  url: string
  linkBacks: string[]
}): Promise<boolean> => {
  try {
    const response = await safeRemoteFetch({
      url,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
      },
      maxBodyBytes: PROFILE_LINK_MAX_BODY_BYTES,
      maxRedirects: PROFILE_LINK_MAX_REDIRECTS,
      connectTimeoutInMilliseconds: PROFILE_LINK_CONNECT_TIMEOUT_MS,
      readTimeoutInMilliseconds: PROFILE_LINK_READ_TIMEOUT_MS,
      onBodyTooLarge: 'fail'
    })
    if (response.statusCode !== 200) return false

    const mimeType = (getHeaderValue(response.headers, 'content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!ACCEPTED_CONTENT_TYPES.includes(mimeType)) return false

    return hasRelMeLinkTo(response.body, linkBacks)
  } catch (error) {
    logger.debug({
      message: 'Profile link could not be verified',
      url,
      err: toLoggableError(error)
    })
    return false
  }
}

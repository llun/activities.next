import { isActivityPubContentType } from '@/lib/activities/activityPubResponse'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { parseBareDomain } from '@/lib/utils/accountHandle'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { CrossHostRedirectPolicy } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

// Standard OStatus rel carrying the URL template a server wants remote-follow
// visitors sent to. Mirrors REMOTE_FOLLOW_SUBSCRIBE_REL on the serving side.
export const SUBSCRIBE_REL = 'http://ostatus.org/schema/1.0/subscribe'

// The `self` hrefs that point at an ActivityPub actor. A JRD may list several
// self links (an HTML profile, an Atom feed) and only the ActivityPub-typed
// ones name the actor; untyped self links count only when no self link carries
// a type at all, as in Mastodon's WebFinger self-link lookup.
export const getActivityPubSelfHrefs = (links: WebFinger['links']) => {
  const selfLinks = links.flatMap((link) =>
    link.rel === 'self' && 'href' in link ? [link] : []
  )
  const typed = selfLinks.filter((link) => isActivityPubContentType(link.type))
  if (typed.length > 0) return typed.map((link) => link.href)
  return selfLinks.every((link) => !link.type)
    ? selfLinks.map((link) => link.href)
    : []
}

/**
 * Fetches a remote WebFinger document whole, unlike `getWebfingerSelf` which
 * keeps only the `self` link. Retries are disabled by default: the remote-follow
 * caller is an unauthenticated interactive endpoint, so a slow or dead remote
 * must cost one bounded request rather than several.
 *
 * The account's domain must be a bare host, and the request is built from the
 * validated host, so a value such as `evil.test://allowed.example` — which the
 * federation policy reads as `allowed.example` — cannot send the request to
 * `evil.test`. A cross-host redirect is followed only when federation policy
 * allows the target host, unless the caller passes its own policy.
 */
export const getWebfingerDocument = async ({
  account,
  withNetworkRetry = false,
  responseTimeout,
  allowCrossHostRedirects = isFederatedRedirect
}: {
  account: string
  withNetworkRetry?: boolean
  responseTimeout?: number
  /** See `SafeRemoteFetchOptions.allowCrossHostRedirects`. */
  allowCrossHostRedirects?: CrossHostRedirectPolicy
}): Promise<WebFinger | null> =>
  withSpan('activity', 'getWebfingerDocument', {}, async (span) => {
    const [user, domain, ...rest] = account.split('@')
    if (!user || !domain || rest.length > 0) {
      return null
    }

    const host = parseBareDomain(domain, { requireDot: false })
    if (!host || host === 'bsky.app') return null // Bluesky has no WebFinger
    // Hosts only, as in getWebfingerSelf: never the handle.
    span.setAttribute('webfinger.host', host)

    try {
      const url = new URL(`https://${host}/.well-known/webfinger`)
      url.searchParams.set('resource', `acct:${account}`)

      const { statusCode, body } = await request({
        url: url.toString(),
        headers: {
          Accept: 'application/jrd+json, application/json'
        },
        // Use default retry by setting it to undefined, otherwise 0 retry
        numberOfRetry: withNetworkRetry ? undefined : 0,
        responseTimeout,
        allowCrossHostRedirects
      })
      if (statusCode !== 200) return null

      const parsed = WebFinger.safeParse(JSON.parse(body))
      return parsed.success ? parsed.data : null
    } catch (error) {
      // Name and code only, as in getWebfingerSelf: the thrown error can carry
      // the request URL with its `acct:` resource (Got's `options`, a URL
      // error's `input`) or remote body text (a JSON parse error's message).
      const loggable = Object.assign(
        new Error(`WebFinger lookup failed: ${toLoggableError(error).name}`),
        { code: (error as NodeJS.ErrnoException).code }
      )
      span.recordException(loggable)
      logger.warn({
        message: 'Failed to fetch webfinger document',
        host: host.slice(0, 512),
        err: loggable
      })
      return null
    }
  })

/**
 * Reads the remote-follow URL template a server advertises, or null when it
 * advertises none (callers fall back to Mastodon's conventional path).
 */
export const getWebfingerSubscribeTemplate = async ({
  account
}: {
  account: string
}): Promise<string | null> => {
  const document = await getWebfingerDocument({ account })
  if (!document) return null

  const link = document.links.find(
    (item) => item.rel === SUBSCRIBE_REL && 'template' in item
  )
  return link && 'template' in link ? link.template : null
}

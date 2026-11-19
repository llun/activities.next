import { getActivityPubSelfHrefs } from '@/lib/activities/getWebfingerDocument'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { parseBareDomain } from '@/lib/utils/accountHandle'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

type GetWebfingerSelfFunction = (params: {
  account: string
}) => Promise<string | null>

export const getWebfingerSelf: GetWebfingerSelfFunction = async ({ account }) =>
  withSpan('activity', 'getWebfingerSelf', {}, async (span) => {
    const cleanedAccount = account.replace(/^acct:/i, '').replace(/^@+/, '')
    const [user, domain, ...rest] = cleanedAccount.split('@')
    if (!user || !domain || rest.length > 0) {
      return null
    }

    // The domain must be a bare host, and the request is built from the
    // validated host: `evil.test://allowed.example` reads as `allowed.example`
    // to the federation policy but would send the request to `evil.test`.
    const host = parseBareDomain(domain, { requireDot: false })
    if (!host) return null

    let requestedHost: string | undefined
    let refusedRedirectHost: string | undefined
    try {
      const url = new URL(`https://${host}/.well-known/webfinger`)
      // Logs and the span record the host only, never the handle.
      requestedHost = url.host
      span.setAttribute('webfinger.host', requestedHost.slice(0, 512))
      // The handle's own host is judged like a redirect hop: a host federation
      // policy refuses (or cannot decide) is never contacted.
      if (!(await isFederatedRedirect(url))) return null
      url.searchParams.set('resource', `acct:${user}@${domain}`)

      const { statusCode, body } = await request({
        url: url.toString(),
        headers: {
          Accept: 'application/jrd+json, application/json'
        },
        // A handle's domain may hand WebFinger to another host
        // (`example.com` -> `social.example.com`), but never to one federation
        // policy refuses.
        allowCrossHostRedirects: async (redirectUrl) => {
          if (await isFederatedRedirect(redirectUrl)) return true
          refusedRedirectHost = redirectUrl.host.slice(0, 512)
          return false
        }
      })
      if (statusCode !== 200) {
        return null
      }

      const data = WebFinger.parse(JSON.parse(body))
      return getActivityPubSelfHrefs(data.links)[0] ?? null
    } catch (error) {
      // A redirect federation policy refused is policy at work, not a failure;
      // `isFederatedRedirect` already logged why when the policy could not be
      // read.
      if ((error as NodeJS.ErrnoException).code === 'ERR_CROSS_HOST_REDIRECT') {
        logger.warn({
          message: 'Refused a WebFinger redirect to another host',
          requestedHost: requestedHost?.slice(0, 512),
          refusedRedirectHost
        })
        return null
      }
      // Name and code only: the thrown error can carry the request URL (Got's
      // `options`, a URL error's `input`/`base`) or remote body text (a JSON
      // parse error's message), and the logger serialises its own properties.
      const thrown = toLoggableError(error)
      const loggable = Object.assign(
        new Error(`WebFinger lookup failed: ${thrown.name}`),
        { code: (error as NodeJS.ErrnoException).code }
      )
      span.recordException(loggable)
      logger.error({
        message: 'Failed to fetch webfinger self link',
        requestedHost: requestedHost?.slice(0, 512),
        err: loggable
      })
      return null
    }
  })

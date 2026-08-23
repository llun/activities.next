import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

// Standard OStatus rel carrying the URL template a server wants remote-follow
// visitors sent to. Mirrors REMOTE_FOLLOW_SUBSCRIBE_REL on the serving side.
export const SUBSCRIBE_REL = 'http://ostatus.org/schema/1.0/subscribe'

/**
 * Fetches a remote WebFinger document whole, unlike `getWebfingerSelf` which
 * keeps only the `self` link. Retries are disabled: the caller is an
 * unauthenticated interactive endpoint, so a slow or dead remote must cost one
 * bounded request rather than several.
 */
export const getWebfingerDocument = async ({
  account
}: {
  account: string
}): Promise<WebFinger | null> =>
  withSpan('activity', 'getWebfingerDocument', { account }, async (span) => {
    const [user, domain, ...rest] = account.split('@')
    if (!user || !domain || rest.length > 0) {
      return null
    }

    try {
      const url = new URL(`https://${domain}/.well-known/webfinger`)
      url.searchParams.set('resource', `acct:${account}`)

      const { statusCode, body } = await request({
        url: url.toString(),
        headers: {
          Accept: 'application/jrd+json, application/json'
        },
        numberOfRetry: 0
      })
      if (statusCode !== 200) return null

      const parsed = WebFinger.safeParse(JSON.parse(body))
      return parsed.success ? parsed.data : null
    } catch (error) {
      span.recordException(error as Error)
      logger.warn({
        message: 'Failed to fetch webfinger document',
        account,
        err: toLoggableError(error)
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

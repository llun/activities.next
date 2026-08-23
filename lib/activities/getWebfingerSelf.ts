import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

type GetWebfingerSelfFunction = (params: {
  account: string
}) => Promise<string | null>

export const getWebfingerSelf: GetWebfingerSelfFunction = async ({ account }) =>
  withSpan('activity', 'getWebfingerSelf', { account }, async (span) => {
    const [user, domain, ...rest] = account.split('@')
    if (!user || !domain) {
      return null
    }
    if (rest.length > 0) {
      return null
    }

    try {
      const url = new URL(`https://${domain}/.well-known/webfinger`)
      url.searchParams.set('resource', `acct:${account}`)

      const { statusCode, body } = await request({
        url: url.toString(),
        headers: {
          Accept: 'application/jrd+json, application/json'
        }
      })
      if (statusCode !== 200) {
        return null
      }

      const data = WebFinger.parse(JSON.parse(body))
      const item = data.links.find((item) => item.rel === 'self')
      if (!item || !('href' in item)) {
        return null
      }
      return item.href
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      span.recordException(nodeError)
      logger.error(`[getWebfingerSelf] ${nodeError.message}`)
      return null
    }
  })

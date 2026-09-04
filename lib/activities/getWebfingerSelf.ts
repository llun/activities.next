import { WebFinger } from '@/lib/types/activitypub/webfinger'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

type GetWebfingerSelfFunction = (params: {
  account: string
}) => Promise<string | null>

export const getWebfingerSelf: GetWebfingerSelfFunction = async ({ account }) =>
  withSpan('activity', 'getWebfingerSelf', { account }, async (span) => {
    const cleanedAccount = account.replace(/^acct:/i, '').replace(/^@+/, '')
    const [user, domain, ...rest] = cleanedAccount.split('@')
    if (!user || !domain || rest.length > 0) {
      return null
    }

    try {
      const url = new URL(`https://${domain}/.well-known/webfinger`)
      url.searchParams.set('resource', `acct:${user}@${domain}`)

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
      const loggable = toLoggableError(error)
      span.recordException(loggable)
      logger.error({
        message: 'Failed to fetch webfinger self link',
        account,
        err: loggable
      })
      return null
    }
  })

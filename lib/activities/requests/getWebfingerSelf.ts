import { WebFinger } from '@/lib/activities/types'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

type GetWebfingerSelfFunction = (params: {
  account: string
}) => Promise<string | null>

export const getWebfingerSelf: GetWebfingerSelfFunction = async ({ account }) =>
  getTracer().startActiveSpan(
    'activities.getWebfingerSelf',
    { attributes: { account } },
    async (span) => {
      const [user, domain] = account.split('@')
      if (!user || !domain) {
        span.end()
        return null
      }

      try {
        const { statusCode, body } = await request({
          url: `https://${domain}/.well-known/webfinger?resource=acct:${account}`,
          headers: {
            Accept: 'application/json'
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
      } finally {
        span.end()
      }
    }
  )

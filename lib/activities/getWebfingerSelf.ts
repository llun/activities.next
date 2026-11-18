import { getActivityPubSelfHrefs } from '@/lib/activities/getWebfingerDocument'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
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
        },
        // A handle's domain may hand WebFinger to another host
        // (`example.com` -> `social.example.com`), but never to one federation
        // policy refuses.
        allowCrossHostRedirects: isFederatedRedirect
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
          domain: domain.slice(0, 512)
        })
        return null
      }
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

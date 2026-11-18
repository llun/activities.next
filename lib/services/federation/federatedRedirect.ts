import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// An `allowCrossHostRedirects` policy for an outbound fetch whose caller vetted
// only the URL it asked for: a redirect onto another host is followed only
// when federation policy allows that host, so a blocked or non-allowlisted host
// is never contacted. With no database to decide, the hop is refused.
export const isFederatedRedirect = async (url: URL) => {
  try {
    const database = getDatabase()
    return database ? await canFederateWithDomain(database, url.href) : false
  } catch (error) {
    // `safeRemoteFetch` refuses a hop whose policy throws, but silently: say
    // why here.
    logger.warn({
      message: 'Refused a redirect whose federation policy could not be read',
      redirectHost: url.host.slice(0, 512),
      err: toLoggableError(error)
    })
    return false
  }
}

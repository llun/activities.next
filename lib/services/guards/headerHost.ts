import { IncomingHttpHeaders } from 'http'

import { type Config } from '@/lib/config'
import { getServedHostConfig } from '@/lib/services/domains/servedDomainSnapshot'
import {
  getTrustedHostRules,
  isHostTrustedByRules,
  selectHeaderHost
} from '@/lib/utils/host'

type NextAuthHeaders = Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any

type HostConfig = Pick<Config, 'host' | 'trustedHosts'> & {
  servedDomains?: readonly string[] | null
}

export const isTrustedHeaderHost = (
  host: string | undefined | null,
  config: HostConfig = getServedHostConfig()
) => isHostTrustedByRules(host, getTrustedHostRules(config))

export function headerHost(
  headers: IncomingHttpHeaders | Headers | NextAuthHeaders
): string {
  // The env domains plus the active Admin › Domains rows (see
  // `servedDomainSnapshot`); anything else falls back to the primary host.
  return selectHeaderHost(headers, getServedHostConfig())
}

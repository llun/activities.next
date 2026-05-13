import { IncomingHttpHeaders } from 'http'

import { type Config, getConfig } from '@/lib/config'
import {
  getTrustedHostRules,
  isHostTrustedByRules,
  selectHeaderHost
} from '@/lib/utils/host'

type NextAuthHeaders = Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any

type HostConfig = Pick<Config, 'host' | 'trustedHosts'>

export const isTrustedHeaderHost = (
  host: string | undefined | null,
  config: HostConfig = getConfig()
) => isHostTrustedByRules(host, getTrustedHostRules(config))

export function headerHost(
  headers: IncomingHttpHeaders | Headers | NextAuthHeaders
): string {
  return selectHeaderHost(headers, getConfig())
}

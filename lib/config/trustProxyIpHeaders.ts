import { readRuntimeConfigFile } from './runtimeConfigFile'

export const getTrustProxyIpHeadersConfig = (): boolean => {
  const environmentValue = process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
  if (environmentValue !== undefined) return environmentValue === 'true'

  const fileConfig = readRuntimeConfigFile()
  return fileConfig?.trustProxyIpHeaders === true
}

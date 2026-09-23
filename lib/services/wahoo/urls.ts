import { getConfig } from '@/lib/config'

export const getWahooCallbackUrl = () => {
  const host = getConfig().host
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/v1/settings/fitness/wahoo/callback`
}

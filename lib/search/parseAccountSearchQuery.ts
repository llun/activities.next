import { getConfiguredHost } from '@/lib/config/configuredHost'

import { normalizeAccountSearchQuery } from './normalizeAccountSearchQuery'

export type ParsedAccountSearchQuery = {
  username: string
  domain: string
  account: string
}

const parseAccountUrlQuery = (
  query: string
): ParsedAccountSearchQuery | null => {
  let url: URL
  try {
    url = new URL(query.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const [firstSegment, secondSegment] = url.pathname.split('/').filter(Boolean)
  const username = firstSegment?.startsWith('@')
    ? firstSegment.slice(1)
    : firstSegment === 'users'
      ? secondSegment
      : null
  if (!username || username.includes('@')) return null

  const domain = url.hostname
  if (!domain) return null

  return { username, domain, account: `${username}@${domain}` }
}

export const parseAccountSearchQuery = (
  query: string
): ParsedAccountSearchQuery | null => {
  const accountUrl = parseAccountUrlQuery(query)
  if (accountUrl) return accountUrl

  const cleanedQuery = normalizeAccountSearchQuery(query)
  if (!cleanedQuery) return null

  const parts = cleanedQuery.split('@')
  if (parts.length > 2) return null

  const [username, domain = getConfiguredHost()] = parts
  if (!username || !domain) return null

  return { username, domain, account: `${username}@${domain}` }
}

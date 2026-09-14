import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import { isPublicId } from '@/lib/utils/publicId'

const extractDomainFromUrl = (urlString?: string | null): string => {
  if (!urlString) return ''
  try {
    const url = new URL(urlString)
    return url.host || ''
  } catch {
    return ''
  }
}

const getAccountMention = (
  account?: MastodonStatus['account'] | null,
  fallbackDomain?: string
): string | null => {
  const cleanAcct = (account?.acct || account?.username || '')
    .replace(/^@+/, '')
    .trim()
  if (!cleanAcct) return null

  if (cleanAcct.includes('@')) {
    return `@${cleanAcct}`
  }

  const domain =
    extractDomainFromUrl(account?.url) ||
    extractDomainFromUrl(account?.uri) ||
    fallbackDomain

  if (domain) {
    return `@${cleanAcct}@${domain}`
  }

  return null
}

const getStatusSegment = (
  status: MastodonStatus,
  fallbackUri?: string
): string | null => {
  if (isPublicId(status.id)) {
    return status.id
  }

  const uri = status.uri || fallbackUri || status.id
  return uri ? encodeURIComponent(uri) : null
}

export const getMastodonStatusDetailPath = (
  status: MastodonStatus,
  fallbackUri?: string
): string => {
  const fallbackExternalUrl = status.url || fallbackUri || status.id || ''

  const fallbackDomain =
    extractDomainFromUrl(status.uri) ||
    extractDomainFromUrl(fallbackUri) ||
    extractDomainFromUrl(status.id)

  const mention = getAccountMention(status.account, fallbackDomain)
  const statusSegment = getStatusSegment(status, fallbackUri)

  if (!mention || !statusSegment) {
    return fallbackExternalUrl
  }

  return `/${mention}/${statusSegment}`
}

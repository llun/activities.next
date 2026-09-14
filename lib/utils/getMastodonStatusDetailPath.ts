import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import { isPublicId } from '@/lib/utils/publicId'

const getAccountMention = (account: MastodonStatus['account']) => {
  const cleanAcct = (account.acct || account.username || '').replace(/^@/, '')
  if (cleanAcct.includes('@')) {
    return `@${cleanAcct}`
  }

  try {
    const url = new URL(account.url || account.uri)
    if (url.host) {
      return `@${cleanAcct}@${url.host}`
    }
  } catch {
    // Ignore invalid or relative URLs and fall back to cleanAcct
  }

  return `@${cleanAcct}`
}

const getStatusSegment = (status: MastodonStatus, fallbackUri?: string) => {
  if (isPublicId(status.id)) {
    return status.id
  }

  const uri = status.uri || fallbackUri || status.id
  return encodeURIComponent(uri)
}

export const getMastodonStatusDetailPath = (
  status: MastodonStatus,
  fallbackUri?: string
): string => {
  const mention = getAccountMention(status.account)
  const statusSegment = getStatusSegment(status, fallbackUri)
  return `/${mention}/${statusSegment}`
}

import { getMention } from '@/lib/types/domain/actor'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { isPublicId } from '@/lib/utils/publicId'

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Builds the canonical public URL for quoting a status.
 * Pure helper: takes the host explicitly instead of reading `window`.
 */
export const getQuoteUrl = (quotedStatus: Status, host: string): string => {
  const original = getOriginalStatus(quotedStatus)
  const baseURL = (host.includes('://') ? host : `https://${host}`).replace(
    /\/+$/,
    ''
  )

  // 1. If original.url is already a full absolute web URL, prefer it
  if (
    original.url &&
    /^https?:\/\//i.test(original.url) &&
    !original.url.includes('/users/')
  ) {
    return original.url
  }

  // 2. If actor is present, construct canonical web status URL
  if (original.actor) {
    const idTail = original.id ? original.id.split('/').pop() : undefined
    const urlTail = original.url ? original.url.split('/').pop() : undefined
    const publicId =
      original.publicId ||
      (isPublicId(original.id) ? original.id : undefined) ||
      (original.url && isPublicId(original.url) ? original.url : undefined) ||
      (idTail && isPublicId(idTail) ? idTail : undefined) ||
      (urlTail && isPublicId(urlTail) ? urlTail : undefined)

    if (publicId) {
      return `${baseURL}/${getMention(original.actor, true)}/${publicId}`
    }

    if (original.isLocalActor === false && original.id) {
      return `${baseURL}/${getMention(original.actor, true)}/${encodeURIComponent(original.id)}`
    }
  }

  // 3. If original.url is a full absolute URL
  if (original.url && /^https?:\/\//i.test(original.url)) {
    return original.url
  }

  // 4. If original.url is a relative path
  if (original.url && original.url.startsWith('/')) {
    return `${baseURL}${original.url}`
  }

  // 5. If original.id is a full absolute URL
  if (original.id && /^https?:\/\//i.test(original.id)) {
    return original.id
  }

  // 6. If original.id is a relative path
  if (original.id && original.id.startsWith('/')) {
    return `${baseURL}${original.id}`
  }

  // 7. If original.actor exists and we have an id or url tail
  if (original.actor && (original.id || original.url)) {
    const segment = original.id || original.url
    return `${baseURL}/${getMention(original.actor, true)}/${encodeURIComponent(segment)}`
  }

  // 8. Fallback to full URL using id or url
  const fallbackId = original.url || original.id
  return fallbackId
    ? `${baseURL}/statuses/${encodeURIComponent(fallbackId)}`
    : baseURL
}

/**
 * Builds the text prefix (e.g. `RE: https://.../statuses/...\\n\\n`) when quoting a status.
 */
export const getQuotePrefix = (
  quotedStatus?: Status,
  host: string = ''
): string => {
  if (!quotedStatus) return ''
  return `RE: ${getQuoteUrl(quotedStatus, host)}\n\n`
}

/**
 * Builds a regex to match quote prefixes for a given quoted status.
 */
export const getQuotePrefixRegex = (
  quotedStatus: Status,
  host: string
): RegExp => {
  const original = getOriginalStatus(quotedStatus)
  const quoteUrl = getQuoteUrl(quotedStatus, host)
  const urls = [quoteUrl, original.url, original.id, original.publicId].filter(
    Boolean
  ) as string[]
  return new RegExp(`^RE: (${urls.map(escapeRegExp).join('|')})\\s*`)
}

/**
 * Strips the quote prefix from post text if present.
 */
export const stripQuotePrefix = (
  text: string,
  quotedStatus: Status,
  host: string
): string => {
  const prefixRegex = getQuotePrefixRegex(quotedStatus, host)
  const match = text.match(prefixRegex)
  if (!match) return text
  return text.slice(match[0].length)
}

import dns, { type LookupAddress } from 'node:dns'
import https from 'node:https'
import { type LookupFunction, isIP } from 'node:net'

import {
  getSafeImageDownloadUrl,
  isRestrictedDownloadHostname
} from '@/lib/utils/safeImageDownload'
import { isUnsafeAddress, normalizeHostname } from '@/lib/utils/unsafeAddress'

// A push endpoint is a URL the CLIENT chooses, and every notification for the
// actor makes this server POST to it. Browsers only ever hand out public HTTPS
// push-service URLs, but the subscribe routes can be called directly, so
// without these guards an account with the `push` scope had a blind SSRF and
// fan-out primitive (and, through the 404/410 cleanup, a probe oracle).

// Per-request bound on a delivery, so a slow endpoint cannot hold a socket.
export const PUSH_DELIVERY_TIMEOUT_MS = 10_000

/**
 * Subscribe-time check: an `https:` URL with no credentials whose host is not
 * a local name and resolves only to public addresses. Same policy as every
 * other outbound fetch of a URL this instance did not choose.
 */
export const isAllowedPushEndpoint = async (endpoint: string) =>
  (await getSafeImageDownloadUrl(endpoint)) !== null

/**
 * Send-time check that needs no DNS: the scheme, and a host that is not a
 * local name or a restricted IP literal. A NAME is checked by
 * `pushDeliveryAgent`'s lookup instead — at connect time, on the address the
 * socket actually uses, so a record that changes after subscribe (rebinding)
 * is refused too. An IP literal never reaches that lookup, hence this.
 */
export const isDeliverablePushEndpoint = (endpoint: string) => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const hostname = normalizeHostname(url.hostname.trim())
  if (!hostname || isRestrictedDownloadHostname(hostname)) return false
  if (isIP(hostname)) return !isUnsafeAddress(hostname)
  return true
}

class RestrictedPushAddressError extends Error {
  code = 'ERESTRICTEDADDRESS'
  constructor() {
    super('Push endpoint resolves to a restricted address')
    this.name = 'RestrictedPushAddressError'
  }
}

// Resolves every address and refuses the connection if ANY is restricted, so
// a record mixing a public and a private answer cannot be raced.
export const guardedPushLookup: LookupFunction = (
  hostname,
  options,
  callback
) => {
  dns.lookup(
    hostname,
    { ...options, all: true, verbatim: true },
    (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, '', 0)
        return
      }
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => isUnsafeAddress(address))
      ) {
        callback(new RestrictedPushAddressError(), '', 0)
        return
      }
      if (options.all) {
        callback(null, addresses)
        return
      }
      callback(null, addresses[0].address, addresses[0].family)
    }
  )
}

export const pushDeliveryAgent = new https.Agent({ lookup: guardedPushLookup })

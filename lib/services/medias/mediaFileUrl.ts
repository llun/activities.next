import { HostRuleConfig, isOwnInstanceHost } from '@/lib/utils/host'

// Both storage drivers serve their files from this route, so a URL under it on
// one of THIS instance's hosts names a stored media path.
const MEDIA_FILE_URL_PATH = '/api/v1/files/'

const isLocalHost = (host: string) =>
  host.startsWith('localhost') ||
  host.startsWith('127.0.0.1') ||
  host.startsWith('::1') ||
  host.startsWith('[::1]')

/**
 * Public URL for a stored media path.
 *
 * Both the local-file and object storages serve their files through
 * `/api/v1/files/:path`, so a path resolves to a URL without going back through
 * the storage driver. Shared by `getMediaAttachment` (the Mastodon entity) and
 * by callers holding a bare stored path, such as the route map's JPEG twin.
 */
export const getMediaFileUrl = (host: string, mediaPath: string): string => {
  const protocol = isLocalHost(host) ? 'http' : 'https'
  return `${protocol}://${host}${MEDIA_FILE_URL_PATH}${mediaPath}`
}

const getOwnPathname = (url: string, config: HostRuleConfig): string | null => {
  // A host-relative URL can only be served by this instance. A
  // protocol-relative `//other.example/...` starts with a slash too, but it
  // keeps somebody else's authority in the value, so it can never match the
  // media route prefix the caller checks next.
  if (url.startsWith('/')) return url.split(/[?#]/)[0]

  try {
    const parsed = new URL(url)
    return isOwnInstanceHost(parsed.host, config) ? parsed.pathname : null
  } catch {
    return null
  }
}

/**
 * The stored media path a URL names, or null when the URL is not one this
 * instance serves. The inverse of `getMediaFileUrl`.
 *
 * The host check is the point: `/api/v1/files/` is this project's own route, so
 * every OTHER activities.next instance serves its attachment URLs under exactly
 * that path. Matching on the path alone reads a remote instance's URL as a
 * local storage path, which then misses in storage — and, at a caller that
 * treats "not local" as "fetch it over HTTP instead", skips the branch that
 * would have retrieved the file correctly.
 */
export const getMediaPathFromFileUrl = (
  url: string,
  config: HostRuleConfig
): string | null => {
  const pathname = getOwnPathname(url, config)
  if (!pathname?.startsWith(MEDIA_FILE_URL_PATH)) return null

  const encodedPath = pathname.slice(MEDIA_FILE_URL_PATH.length)
  if (!encodedPath) return null

  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return encodedPath
  }
}

import { HostRuleConfig, isOwnInstanceHost } from '@/lib/utils/host'

// Both storage drivers serve their files from this route, so a URL under it on
// one of THIS instance's hosts names a stored media path. Exported for the one
// caller asking a narrower question than "is this ours" — whether a stored
// value is a host-relative media URL an earlier backfill wrote.
export const MEDIA_FILE_URL_PATH = '/api/v1/files/'

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

// A segment of nothing but dots and spaces is refused whenever it carries two
// of those dots. Windows normalises trailing dots away, so `.. ` and `...` can
// reach the parent directory a bare `..` names — and Node's own `path.win32`
// does NOT model that, so neither `path.resolve` nor the containment check
// downstream would see it. Refusing the whole shape is deliberately wider than
// the exact spellings Win32 collapses: nothing this instance stores is ever
// named out of dots and spaces, so over-refusing costs nothing and does not
// depend on getting the platform's rules exactly right. A lone `.` stays legal
// — it resolves to the directory it already sits in.
const isUpwardSegment = (segment: string) =>
  /^[. ]+$/.test(segment) && (segment.match(/\./g) ?? []).length >= 2

/**
 * Whether a decoded path walks upwards, is absolute, or is one no filesystem
 * will open — none of which is ever a path this instance stores.
 *
 * The check cannot be left to the URL parser. `new URL()` does resolve dot
 * segments, decoding the dots themselves to find them, but only where the
 * separators are literal slashes: `/api/v1/files/..%2f..%2fsecrets/env`
 * arrives here still spelled `..%2f` and decodes to `../../secrets/env`. The
 * host-relative branch parses no URL at all, so there a plain
 * `/api/v1/files/../../secrets/env` arrives untouched. Either way it has to
 * run AFTER decoding.
 *
 * Windows is covered deliberately, because the archive and maintenance scripts
 * run wherever the operator runs them: `\` is a separator there, `C:` is
 * absolute, and a component of bare dots can reach the parent directory. That
 * is traversal coverage, not a claim that every Win32 path quirk is handled —
 * a reserved device name such as `CON` still resolves to a device on Windows.
 *
 * `LocalFileStorage.getFile` makes the same containment check when SERVING
 * such a path — and shares that same device-name blind spot; `S3FileStorage.getFile`
 * makes none at all, so on that driver the key is merely inert rather than
 * refused, which is why this has to be decided here.
 *
 * A NUL byte is refused because Node rejects one in a path: on the profile
 * image route that is a caught warning, but on the storage-plan route it
 * aborts the whole export.
 *
 * Only a segment that resolves to `..` is refused, so `ab/..cd.webp` stays an
 * ordinary stored file name.
 *
 * Exported because callers that recover such a path by another route have to
 * apply the same rule — `scripts/backup/actorArchive.ts` confirms containment
 * again at `copyProfileImage`, where the path becomes a file read.
 *
 * `scripts/maintenance/backfillMediaBlurhash.ts` used to be the other one, and
 * is not any more: #1570 moved its host half onto `getMediaPathFromFileUrl`
 * too, so it now gets this check by calling that rather than by importing this.
 */
export const isTraversingStoragePath = (storagePath: string) =>
  /^([/\\]|[A-Za-z]:)/.test(storagePath) ||
  storagePath.includes('\0') ||
  storagePath.split(/[/\\]/).some(isUpwardSegment)

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
 *
 * A path that escapes the media root is refused for the same reason a foreign
 * host is: this instance does not store it. Answering null here covers every
 * caller at once, rather than leaving each one to remember — and each of them
 * already has a "not one of ours" branch to take.
 */
export const getMediaPathFromFileUrl = (
  url: string,
  config: HostRuleConfig
): string | null => {
  const pathname = getOwnPathname(url, config)
  if (!pathname?.startsWith(MEDIA_FILE_URL_PATH)) return null

  const encodedPath = pathname.slice(MEDIA_FILE_URL_PATH.length)
  if (!encodedPath) return null

  // A malformed escape leaves the path undecoded rather than dropping it, so
  // the traversal check reads whichever spelling the caller would go on to
  // use. Nothing escapes through the fallback: an undecodable `%2f` is a
  // literal character to `path.join` too.
  let mediaPath: string
  try {
    mediaPath = decodeURIComponent(encodedPath)
  } catch {
    mediaPath = encodedPath
  }

  return isTraversingStoragePath(mediaPath) ? null : mediaPath
}

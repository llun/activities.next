import { getMediaReservedFitnessPathPrefixes } from '@/lib/config/fitnessStorage'

// How many times a path may be percent-decoded while canonicalising. Next has
// already decoded the catch-all segments once, so a client that double-encodes
// (`%2566itness`) hands us `%66itness` — still one decode away from `fitness`.
// The loop stops at a fixed point; the cap only bounds a pathological input.
const MAX_DECODE_PASSES = 5

const decodeToFixedPoint = (value: string): string => {
  let current = value
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      // A malformed escape (`%zz`, a lone `%`) is not decodable. Whatever it is,
      // it is not a legitimate media key, and stopping here is safe: the value
      // compared below is then the most-decoded form we could obtain.
      return current
    }
    if (decoded === current) return current
    current = decoded
  }
  return current
}

/**
 * Whether `userPath` addresses fitness storage and so must not be served by the
 * media route, which has no access control of its own.
 *
 * The comparison is made on a CANONICAL form, not on the string the route
 * happens to hold, because the value does not stay that string. When media
 * storage has a public hostname, `S3FileStorage.getFile` builds
 * `https://<hostname>/<path>` and the route hands it to `Response.redirect`,
 * which runs the WHATWG URL parser — and that parser normalises two things
 * `path.normalize` does not:
 *
 *   - a backslash is a segment separator for special schemes, so
 *     `medias\..\fitness/x.gpx` collapses to `/fitness/x.gpx`;
 *   - `%2e` counts as a dot segment, so `medias/%2e%2e/fitness/x.gpx` does too.
 *
 * A third form never collapses locally at all: `%66itness/x.gpx` reaches the
 * origin percent-encoded and is decoded there. Each of those passed a check
 * written against the raw path while the emitted `Location` pointed straight at
 * the reserved prefix, so the canonicalisation below folds all three before
 * comparing: backslashes become separators, escapes are decoded to a fixed
 * point, dot segments are resolved, and leading separators are stripped.
 */
export const isReservedFitnessMediaPath = (userPath: string): boolean => {
  const decoded = decodeToFixedPoint(userPath)
  // Treat both separators the same way the URL parser will, then resolve `.`
  // and `..` with POSIX rules and drop any leading separators or parent
  // references so a prefix comparison sees the segment that actually addresses
  // the object.
  const segments: string[] = []
  for (const segment of decoded.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  const canonicalPath = segments.join('/').toLowerCase()
  return getMediaReservedFitnessPathPrefixes().some(
    (prefix) =>
      canonicalPath === prefix || canonicalPath.startsWith(`${prefix}/`)
  )
}

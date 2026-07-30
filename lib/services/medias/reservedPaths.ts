import { getMediaReservedFitnessPathPrefixes } from '@/lib/config/fitnessStorage'

// How many times a path may be percent-decoded while canonicalising. Next has
// already decoded the catch-all segments once, so a client that double-encodes
// (`%2566itness`) hands us `%66itness` — still one decode away from `fitness`.
// The loop stops at a fixed point; the cap only bounds a pathological input.
const MAX_DECODE_PASSES = 5

// Decoded PER SEGMENT, not over the whole path: `decodeURIComponent` throws on
// the first malformed escape anywhere in its input, so decoding the joined path
// let one bad segment protect every other one. `%66itness/x.gpx?%zz` came back
// undecoded and sailed past, while the `Location` the URL parser built dropped
// the `?%zz` and left `/%66itness/x.gpx` for the origin to decode.
const decodeSegmentToFixedPoint = (segment: string): string => {
  let current = segment
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      // Undecodable on its own; leave it as-is. It cannot match a prefix, and it
      // no longer stops its neighbours from being decoded.
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
  // Tab, CR and LF are removed outright before anything else: the WHATWG URL
  // parser strips them from a path, so `fit\tness/x.gpx` reaches the origin as
  // `fitness/x.gpx` while a naive comparison sees a tab and finds no match.
  // Backslashes then become separators, because that parser treats them as one
  // for special schemes.
  const withUrlSeparators = userPath
    .replace(/[\t\r\n]/g, '')
    .replace(/\\/g, '/')

  // Decode each segment on its own, then resolve `.` and `..` with POSIX rules
  // and drop empties, so a prefix comparison sees the segment that actually
  // addresses the object.
  const segments: string[] = []
  for (const rawSegment of withUrlSeparators.split('/')) {
    const segment = decodeSegmentToFixedPoint(rawSegment)
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    // A decoded segment can itself contain separators (`%2Ffitness`), so fold it
    // back through the same split rather than trusting it to be one segment.
    for (const nested of segment.replace(/\\/g, '/').split('/')) {
      if (!nested || nested === '.') continue
      if (nested === '..') {
        segments.pop()
        continue
      }
      segments.push(nested)
    }
  }

  const canonicalPath = segments.join('/').toLowerCase()
  return getMediaReservedFitnessPathPrefixes().some(
    (prefix) =>
      canonicalPath === prefix || canonicalPath.startsWith(`${prefix}/`)
  )
}

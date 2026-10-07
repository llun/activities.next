import crypto from 'node:crypto'

import { parseSfDictionary } from '@/lib/utils/structuredFields'

export type ContentDigestResult =
  'match' | 'mismatch' | 'unsupported' | 'malformed'

export const MAX_CONTENT_DIGEST_LENGTH = 1024

const ALGORITHMS: Record<string, string> = {
  'sha-256': 'sha256',
  'sha-512': 'sha512'
}

/**
 * Verify an RFC 9530 `Content-Digest` header value against a request body.
 * Supports sha-256 and sha-512; unknown algorithms are ignored unless no
 * supported algorithm is present. Every supported digest must match.
 */
export function verifyContentDigest(
  header: string,
  body: Buffer
): ContentDigestResult {
  if (header.length > MAX_CONTENT_DIGEST_LENGTH) return 'malformed'
  const dict = parseSfDictionary(header)
  if (!dict || dict.size === 0) return 'malformed'

  let supported = 0
  for (const [name, member] of dict) {
    if (member.kind !== 'item' || member.item.type !== 'bytes') {
      return 'malformed'
    }
    const algorithm = ALGORITHMS[name]
    if (!algorithm) continue
    supported++
    const expected = crypto.createHash(algorithm).update(body).digest()
    const actual = member.item.value
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      return 'mismatch'
    }
  }
  return supported === 0 ? 'unsupported' : 'match'
}

export function createContentDigestHeader(body: Buffer): string {
  return `sha-256=:${crypto.createHash('sha256').update(body).digest('base64')}:`
}

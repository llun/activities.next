import crypto from 'crypto'

/**
 * Constant-time string comparison for secrets (webhook tokens, OAuth state).
 * crypto.timingSafeEqual requires equal-length buffers, so unequal lengths
 * return false after a self-comparison that keeps the work comparable. The
 * compared values are fixed-length server-generated tokens, so revealing the
 * length is not sensitive.
 */
export const timingSafeStringEqual = (
  a: string | null | undefined,
  b: string | null | undefined
): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) {
    crypto.timingSafeEqual(bufferA, bufferA)
    return false
  }
  return crypto.timingSafeEqual(bufferA, bufferB)
}

import crypto from 'crypto'

/**
 * Constant-time string comparison for secrets (webhook tokens, OAuth state).
 * Both inputs are hashed to fixed-length digests first so the comparison
 * neither leaks length information nor requires equal-length inputs.
 */
export const timingSafeStringEqual = (
  a: string | null | undefined,
  b: string | null | undefined
): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const digestA = crypto.createHash('sha256').update(a).digest()
  const digestB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

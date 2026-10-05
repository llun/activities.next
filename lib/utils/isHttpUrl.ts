/**
 * True when `value` parses as an absolute `http:` or `https:` URL.
 *
 * Remote ActivityPub documents carry urls as free-form strings, so a
 * `javascript:`/`data:`/`vbscript:` value survives schema validation. Any url
 * the server persists from a peer and later hands a client as a link target
 * (status `url`, attachment `url`, quote target) must pass this first.
 */
export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

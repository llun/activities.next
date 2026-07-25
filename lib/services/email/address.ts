// Pull the bare addr-spec out of a header value. Handles the three shapes an
// inbound webhook realistically hands us: a bare address, a display name with
// an angle-addr (`"Someone" <a@b>`), and either of those with stray
// whitespace. Anything else returns null rather than a half-parsed guess.
export const parseEmailAddress = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null

  const angleStart = value.lastIndexOf('<')
  const angleEnd = value.lastIndexOf('>')
  const candidate =
    angleStart !== -1 && angleEnd > angleStart
      ? value.slice(angleStart + 1, angleEnd)
      : value

  const address = candidate.trim()
  if (address.length === 0) return null

  // Exactly one @, with something on both sides. Local parts may legally
  // contain a quoted @, but no address this server mints does, and accepting
  // one would only widen what the recipient matcher has to reason about.
  const atIndex = address.indexOf('@')
  if (atIndex <= 0 || atIndex !== address.lastIndexOf('@')) return null
  if (atIndex === address.length - 1) return null
  if (/\s/.test(address)) return null

  return address
}

// Split a parsed address into its two halves. The domain is lowercased (DNS is
// case-insensitive); the local part is NOT, because RFC 5321 §2.4 makes it
// case-sensitive and the reply token lives there.
export const splitEmailAddress = (address: string) => {
  const atIndex = address.indexOf('@')
  if (atIndex <= 0) return null
  return {
    localPart: address.slice(0, atIndex),
    domain: address.slice(atIndex + 1).toLowerCase()
  }
}

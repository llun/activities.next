import net from 'node:net'

/**
 * Whether a resolved IP address is one this instance must refuse to connect to.
 *
 * This is the single implementation of that policy. It used to live inside
 * `safeRemoteFetch`, which meant the image-download guard grew a second,
 * hand-rolled copy expressed as a `BlockList` — and the two diverged in five
 * places across three rounds of review: the copy missed the 6to4 relay anycast
 * range and the RFC 6666 discard prefix, and it blanket-blocked the NAT64 and
 * IPv4-compatible ranges instead of decoding the IPv4 they carry, which on a
 * DNS64/NAT64 deployment would have refused every public IPv4-only origin.
 *
 * Both guards now import from here, so there is nothing left to diverge.
 */
const stripIpv6Brackets = (hostname: string) =>
  hostname.replace(/^\[/, '').replace(/\]$/, '')

export const normalizeHostname = (hostname: string) =>
  stripIpv6Brackets(hostname).toLowerCase()

const parseIpv4Bytes = (address: string) => {
  const bytes = address.split('.').map((part) => Number(part))
  if (
    bytes.length !== 4 ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    return null
  }

  return bytes
}

const isUnsafeIpv4 = (address: string) => {
  const bytes = parseIpv4Bytes(address)
  if (!bytes) return true

  const [first, second, third, fourth] = bytes

  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224 ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
  )
}

const isIpv4Loopback = (address: string) => parseIpv4Bytes(address)?.[0] === 127

const ipv4ToIpv6Groups = (address: string) => {
  const bytes = parseIpv4Bytes(address)
  if (!bytes) return null

  return [
    ((bytes[0] ?? 0) << 8) + (bytes[1] ?? 0),
    ((bytes[2] ?? 0) << 8) + (bytes[3] ?? 0)
  ]
}

const parseIpv6Bytes = (address: string) => {
  const normalizedAddress = normalizeHostname(address).split('%')[0] ?? ''
  const ipv4Match = normalizedAddress.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)
  const ipv4Groups = ipv4Match ? ipv4ToIpv6Groups(ipv4Match[1] ?? '') : null
  if (ipv4Match && !ipv4Groups) return null

  const addressWithoutIpv4 =
    ipv4Match && ipv4Groups
      ? `${normalizedAddress.slice(0, ipv4Match.index)}:${ipv4Groups
          .map((group) => group.toString(16))
          .join(':')}`
      : normalizedAddress
  const sections = addressWithoutIpv4.split('::')
  if (sections.length > 2) return null

  const parseGroups = (value: string) => {
    if (!value) return []
    return value.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      return parseInt(group, 16)
    })
  }

  const head = parseGroups(sections[0] ?? '')
  const tail = parseGroups(sections[1] ?? '')
  if (head.includes(null) || tail.includes(null)) return null

  const missingGroupCount = 8 - head.length - tail.length
  if (sections.length === 1 && missingGroupCount !== 0) return null
  if (sections.length === 2 && missingGroupCount < 1) return null

  const groups = [
    ...(head as number[]),
    ...Array.from({ length: missingGroupCount }, () => 0),
    ...(tail as number[])
  ]
  if (groups.length !== 8) return null

  return groups.flatMap((group) => [group >> 8, group & 0xff])
}

const isIpv4MappedIpv6 = (bytes: number[]) =>
  bytes.slice(0, 10).every((byte) => byte === 0) &&
  bytes[10] === 0xff &&
  bytes[11] === 0xff

const hasIpv4CompatibleIpv6Tail = (bytes: number[]) =>
  bytes.slice(0, 12).every((byte) => byte === 0) &&
  bytes.slice(12).some((byte) => byte !== 0)

const isWellKnownNat64Ipv6 = (bytes: number[]) =>
  bytes[0] === 0x00 &&
  bytes[1] === 0x64 &&
  bytes[2] === 0xff &&
  bytes[3] === 0x9b &&
  bytes.slice(4, 12).every((byte) => byte === 0)

const isRfc8215LocalUseNat64Ipv6 = (bytes: number[]) =>
  bytes[0] === 0x00 &&
  bytes[1] === 0x64 &&
  bytes[2] === 0xff &&
  bytes[3] === 0x9b &&
  bytes[4] === 0x00 &&
  bytes[5] === 0x01

const getIpv4Tail = (bytes: number[]) => bytes.slice(12).join('.')

const getPrefix48EmbeddedIpv4 = (bytes: number[]) =>
  [bytes[6], bytes[7], bytes[9], bytes[10]].join('.')

const isUnsafeIpv6 = (address: string) => {
  const bytes = parseIpv6Bytes(address)
  if (!bytes) return true

  if (
    isIpv4MappedIpv6(bytes) ||
    hasIpv4CompatibleIpv6Tail(bytes) ||
    isWellKnownNat64Ipv6(bytes)
  ) {
    return isUnsafeIpv4(getIpv4Tail(bytes))
  }
  if (isRfc8215LocalUseNat64Ipv6(bytes)) {
    return isUnsafeIpv4(getPrefix48EmbeddedIpv4(bytes))
  }

  const isUnspecified = bytes.every((byte) => byte === 0)
  const isLoopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  const isDiscard =
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes.slice(2, 8).every((byte) => byte === 0)
  const isTeredo =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  const isDeprecatedOrchid =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    (bytes[3] & 0xf0) === 0x10
  const isOrchidV2 =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    (bytes[3] & 0xf0) === 0x20
  const is6to4 = bytes[0] === 0x20 && bytes[1] === 0x02
  const isDocumentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80
  const isMulticast = bytes[0] === 0xff

  return (
    isUnspecified ||
    isLoopback ||
    isDiscard ||
    isTeredo ||
    isDeprecatedOrchid ||
    isOrchidV2 ||
    is6to4 ||
    isDocumentation ||
    isUniqueLocal ||
    isLinkLocal ||
    isMulticast
  )
}

const isIpv6Loopback = (address: string) => {
  const bytes = parseIpv6Bytes(address)
  return (
    !!bytes && bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  )
}

export const isUnsafeAddress = (address: string) => {
  const normalizedAddress = normalizeHostname(address)
  const ipVersion = net.isIP(normalizedAddress)
  if (ipVersion === 4) return isUnsafeIpv4(normalizedAddress)
  if (ipVersion === 6) return isUnsafeIpv6(normalizedAddress)

  return true
}

export const isLoopbackAddress = (address: string) => {
  const normalizedAddress = normalizeHostname(address)
  const ipVersion = net.isIP(normalizedAddress)
  if (ipVersion === 4) return isIpv4Loopback(normalizedAddress)
  if (ipVersion === 6) return isIpv6Loopback(normalizedAddress)

  return false
}

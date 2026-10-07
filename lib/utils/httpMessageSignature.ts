import crypto from 'node:crypto'

import {
  SfBareItem,
  SfInnerList,
  parseSfDictionary,
  serializeSfInnerList
} from '@/lib/utils/structuredFields'
import { withSpan } from '@/lib/utils/trace'

/** Upper bound on the Signature-Input header we are willing to parse. */
export const MAX_SIGNATURE_INPUT_LENGTH = 8192
/** Upper bound on covered components in a single signature. */
export const MAX_COVERED_COMPONENTS = 32

const DERIVED_COMPONENTS = new Set([
  '@method',
  '@target-uri',
  '@authority',
  '@scheme',
  '@path',
  '@query',
  '@request-target'
])
const HEADER_COMPONENT = /^[a-z0-9!#$%&'*+\-.^_`|~]+$/

export interface ParsedHttpMessageSignature {
  label: string
  components: string[]
  keyId: string
  algorithm: string | null
  createdSec: number | null
  expiresSec: number | null
  signature: Buffer
  /** Canonical serialization of the Signature-Input inner list. */
  signatureParams: string
}

export interface HttpMessageSignatureRequest {
  method: string
  targetUri: string
  headers: Headers
}

const findParam = (list: SfInnerList, name: string): SfBareItem | undefined =>
  list.params.find(([key]) => key === name)?.[1]

/**
 * Parse the first signature label present in both `Signature-Input` and
 * `Signature`. Does not check which components are covered; use
 * {@link hasRequiredHttpMessageSignatureComponents} for that. Returns null for
 * anything malformed or outside the supported subset.
 */
export function parseHttpMessageSignature(
  headers: Headers
): ParsedHttpMessageSignature | null {
  try {
    const inputHeader = headers.get('signature-input')
    const signatureHeader = headers.get('signature')
    if (!inputHeader || !signatureHeader) return null
    if (inputHeader.length > MAX_SIGNATURE_INPUT_LENGTH) return null
    if (signatureHeader.length > MAX_SIGNATURE_INPUT_LENGTH) return null

    const inputs = parseSfDictionary(inputHeader)
    const signatures = parseSfDictionary(signatureHeader)
    if (!inputs || !signatures) return null

    for (const [label, member] of inputs) {
      const sigMember = signatures.get(label)
      if (!sigMember) continue
      if (member.kind !== 'innerList') return null
      if (sigMember.kind !== 'item' || sigMember.item.type !== 'bytes') {
        return null
      }
      if (member.items.length > MAX_COVERED_COMPONENTS) return null

      const components: string[] = []
      for (const covered of member.items) {
        if (covered.item.type !== 'string' || covered.params.length > 0) {
          return null
        }
        const name = covered.item.value
        const allowed = name.startsWith('@')
          ? DERIVED_COMPONENTS.has(name)
          : HEADER_COMPONENT.test(name)
        if (!allowed || components.includes(name)) return null
        components.push(name)
      }

      const keyId = findParam(member, 'keyid')
      if (!keyId || keyId.type !== 'string' || keyId.value.length === 0) {
        return null
      }
      const alg = findParam(member, 'alg')
      if (alg && alg.type !== 'string') return null
      const created = findParam(member, 'created')
      if (created && created.type !== 'integer') return null
      const expires = findParam(member, 'expires')
      if (expires && expires.type !== 'integer') return null

      return {
        label,
        components,
        keyId: keyId.value,
        algorithm: alg ? alg.value : null,
        createdSec: created ? created.value : null,
        expiresSec: expires ? expires.value : null,
        signature: sigMember.item.value,
        signatureParams: serializeSfInnerList(member)
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Whether the covered components are enough for us to trust the signature to
 * bind the request: method, destination, query (when present), and for POST
 * the body digest.
 */
export function hasRequiredHttpMessageSignatureComponents(
  components: string[],
  method: string,
  targetUri: string
): boolean {
  try {
    const has = (name: string) => components.includes(name)
    if (!has('@method')) return false
    if (!has('@target-uri') && !(has('@authority') && has('@path'))) {
      return false
    }
    if (
      new URL(targetUri).search !== '' &&
      !has('@target-uri') &&
      !has('@query') &&
      !has('@request-target')
    ) {
      return false
    }
    const upper = method.toUpperCase()
    if (upper === 'POST' && !has('content-digest')) return false
    if (upper === 'GET' && !has('@target-uri') && !has('@authority')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

const componentValue = (
  name: string,
  request: HttpMessageSignatureRequest,
  url: URL
): string | null => {
  switch (name) {
    case '@method':
      return request.method
    case '@target-uri':
      return request.targetUri
    case '@authority':
      return url.host.toLowerCase()
    case '@scheme':
      return url.protocol.replace(/:$/, '').toLowerCase()
    case '@path':
      return url.pathname || '/'
    case '@query':
      return url.search || '?'
    case '@request-target':
      return `${url.pathname || '/'}${url.search}`
    default: {
      const value = request.headers.get(name)
      return value === null ? null : value.trim()
    }
  }
}

/**
 * Build the RFC 9421 section 2.5 signature base from our own view of the
 * request. Returns null if a covered component cannot be derived.
 */
export function buildSignatureBase(
  parsed: ParsedHttpMessageSignature,
  request: HttpMessageSignatureRequest
): string | null {
  try {
    const url = new URL(request.targetUri)
    const lines: string[] = []
    for (const name of parsed.components) {
      const value = componentValue(name, request, url)
      if (value === null || /[\r\n]/.test(value)) return null
      lines.push(`"${name}": ${value}`)
    }
    lines.push(`"@signature-params": ${parsed.signatureParams}`)
    return lines.join('\n')
  } catch {
    return null
  }
}

/**
 * Verify an RFC 9421 signature with rsa-v1_5-sha256 or ed25519. The algorithm
 * must agree with the key's actual type; when `alg` is absent it is inferred
 * from the key.
 */
export async function verifyHttpMessageSignature(
  parsed: ParsedHttpMessageSignature,
  request: HttpMessageSignatureRequest,
  publicKeyPem: string
): Promise<boolean> {
  return withSpan(
    'signature',
    'verifyRfc9421',
    { label: parsed.label },
    async () => {
      try {
        const base = buildSignatureBase(parsed, request)
        if (base === null) return false

        const key = crypto.createPublicKey(publicKeyPem)
        const keyType = key.asymmetricKeyType
        const message = Buffer.from(base, 'utf8')

        const algorithm =
          parsed.algorithm ??
          (keyType === 'rsa'
            ? 'rsa-v1_5-sha256'
            : keyType === 'ed25519'
              ? 'ed25519'
              : null)

        if (algorithm === 'rsa-v1_5-sha256' && keyType === 'rsa') {
          return crypto.verify('sha256', message, key, parsed.signature)
        }
        if (algorithm === 'ed25519' && keyType === 'ed25519') {
          return crypto.verify(null, message, key, parsed.signature)
        }
        return false
      } catch {
        return false
      }
    }
  )
}

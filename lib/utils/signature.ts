import crypto from 'crypto'
import { IncomingHttpHeaders } from 'http'
import util from 'util'

import { getConfig } from '@/lib/config'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Actor } from '@/lib/types/domain/actor'
import { withSpan } from '@/lib/utils/trace'

interface StringMap {
  [key: string]: string
}

export type SignedHttpMethod = 'GET' | 'POST'

export async function parse(signature: string): Promise<StringMap> {
  try {
    const result: StringMap = {}
    const regex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,;\s]+))/g
    let match
    while ((match = regex.exec(signature)) !== null) {
      result[match[1]] = match[2] !== undefined ? match[2] : match[3]
    }
    return result
  } catch {
    return {}
  }
}

export async function verify(
  requestTarget: string,
  headers: IncomingHttpHeaders | Headers,
  publicKey: string
) {
  return withSpan('signature', 'verify', { requestTarget }, async () => {
    try {
      const requestSignature = getHeadersValue(headers, 'signature')
      if (!requestSignature || typeof requestSignature !== 'string') {
        return false
      }
      const signatureParts = await parse(requestSignature)
      const algorithm = (signatureParts.algorithm ?? 'hs2019').toLowerCase()
      if (algorithm !== 'rsa-sha256' && algorithm !== 'hs2019') {
        return false
      }

      const defaultHeaders = algorithm === 'hs2019' ? '(created)' : 'date'
      const headersList = (signatureParts.headers ?? defaultHeaders)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)

      if (headersList.length === 0) {
        return false
      }

      const signedHeaderLines: string[] = []
      for (const item of headersList) {
        if (item === '(request-target)') {
          signedHeaderLines.push(`(request-target): ${requestTarget}`)
        } else if (item === 'host') {
          signedHeaderLines.push(`host: ${headerHost(headers)}`)
        } else if (item === '(created)') {
          if (algorithm !== 'hs2019' || !signatureParts.created) {
            return false
          }
          signedHeaderLines.push(`(created): ${signatureParts.created}`)
        } else if (item === '(expires)') {
          if (algorithm !== 'hs2019' || !signatureParts.expires) {
            return false
          }
          signedHeaderLines.push(`(expires): ${signatureParts.expires}`)
        } else {
          const headerValue = getHeadersValue(headers, item)
          if (headerValue === undefined) {
            return false
          }
          signedHeaderLines.push(
            `${item}: ${Array.isArray(headerValue) ? headerValue.join(', ') : headerValue}`
          )
        }
      }

      const comparedSignedString = signedHeaderLines.join('\n')
      const signature = signatureParts.signature
      if (!signature) {
        return false
      }

      const verifier = crypto.createVerify('rsa-sha256')
      verifier.update(comparedSignedString)
      return verifier.verify(publicKey, signature, 'base64')
    } catch {
      return false
    }
  })
}

export function signedHeaders(
  currentActor: Actor,
  method: SignedHttpMethod,
  targetUrl: string,
  content?: unknown
) {
  const url = new URL(targetUrl)
  const host = url.host
  const date = new Date().toUTCString()
  const requestTargetPath = `${url.pathname}${url.search}`
  const requestTargetMethod = method.toLowerCase()
  const headers: Record<string, string> = {
    host,
    date
  }
  const headerKeys = ['(request-target)', 'host', 'date']

  if (content) {
    const digest = `SHA-256=${crypto
      .createHash('sha-256')
      .update(JSON.stringify(content))
      .digest('base64')}`
    const contentType = 'application/activity+json'
    headers['digest'] = digest
    headers['content-type'] = contentType
    headerKeys.push('digest', 'content-type')
  }

  if (!currentActor.privateKey) {
    return headers
  }

  const signedString = headerKeys
    .map((key) => {
      if (key === '(request-target)') {
        return `(request-target): ${requestTargetMethod} ${requestTargetPath}`
      }
      return `${key}: ${headers[key]}`
    })
    .join('\n')

  const signer = crypto.createSign('rsa-sha256')
  signer.write(signedString)
  signer.end()
  const signature = signer.sign(
    { key: currentActor.privateKey, passphrase: getConfig().secretPhase },
    'base64'
  )
  const signatureHeader = `keyId="${currentActor.id}#main-key",algorithm="rsa-sha256",headers="${headerKeys.join(' ')}",signature="${signature}"`
  return {
    ...headers,
    signature: signatureHeader
  }
}

export function generateKeyPair(secretPhase: string) {
  return util.promisify(crypto.generateKeyPair)('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: secretPhase
    }
  })
}

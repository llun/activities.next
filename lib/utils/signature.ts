import crypto from 'crypto'
import { IncomingHttpHeaders } from 'http'
import { generate } from 'peggy'
import util from 'util'

import { getConfig } from '@/lib/config'
import { Actor } from '@/lib/models/actor'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { getSpan } from '@/lib/utils/trace'

import { FORWARDED_HOST } from '../constants'

export const SIGNATURE_GRAMMAR = `
pairs = (","? pair:pair { return pair })+
pair = key:token "=" '"' value:value '"' { return [key, value] }
value = value:[0-9a-zA-Z:\\/\\.#\\-() \\+\\=]+ { return value.join('') }
token = token:[0-9a-zA-Z]+ { return token.join('') }`.trim()

interface StringMap {
  [key: string]: string
}

export async function parse(signature: string): Promise<StringMap> {
  const parser = generate(SIGNATURE_GRAMMAR)
  try {
    return (parser.parse(signature) as [string, string][]).reduce(
      (out, item) => ({ ...out, [item[0]]: item[1] }),
      {}
    )
  } catch {
    return {}
  }
}

export async function verify(
  requestTarget: string,
  headers: IncomingHttpHeaders | Headers,
  publicKey: string
) {
  const span = getSpan('signature', 'verify', {
    requestTarget
  })

  const requestSignature = getHeadersValue(headers, 'signature')
  const parsedSignature = await parse(requestSignature as string)
  if (!parsedSignature.headers) {
    span.end()
    return false
  }

  const comparedSignedString = parsedSignature.headers
    .split(' ')
    .map((item) => {
      if (item === '(request-target)') {
        return `(request-target): ${requestTarget}`
      }
      if (item === 'host' && getHeadersValue(headers, FORWARDED_HOST)) {
        return `${item}: ${getHeadersValue(headers, FORWARDED_HOST)}`
      }
      return `${item}: ${getHeadersValue(headers, item)}`
    })
    .join('\n')
  const signature = parsedSignature.signature
  const verifier = crypto.createVerify(parsedSignature.algorithm)
  verifier.update(comparedSignedString)
  try {
    return verifier.verify(publicKey, signature, 'base64')
  } catch {
    return false
  } finally {
    span.end()
  }
}

export function sign(
  request: string,
  headers: IncomingHttpHeaders,
  privateKey: string
) {
  const signedString = [
    request,
    `host: ${headers.host}`,
    `date: ${headers.date}`,
    `digest: ${headers.digest}`,
    `content-type: ${headers['content-type']}`
  ].join('\n')
  const signer = crypto.createSign('rsa-sha256')
  signer.write(signedString)
  signer.end()
  return signer.sign(
    { key: privateKey, passphrase: getConfig().secretPhase },
    'base64'
  )
}

export function signedHeaders(
  currentActor: Actor,
  method: string,
  targetUrl: string,
  content: unknown
) {
  const url = new URL(targetUrl)
  const digest = `SHA-256=${crypto
    .createHash('sha-256')
    .update(JSON.stringify(content))
    .digest('base64')}`
  const host = url.host
  const contentType = 'application/activity+json'
  const date = new Date().toUTCString()

  const headers = {
    host,
    date,
    digest,
    'content-type': contentType
  }
  if (!currentActor.privateKey) {
    return headers
  }

  const signature = sign(
    `(request-target): ${method} ${url.pathname}`,
    headers,
    currentActor.privateKey
  )
  const signatureHeader = `keyId="${currentActor.id}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="${signature}"`
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

import crypto from 'crypto'
import { generate } from 'peggy'
import fs from 'fs/promises'
import path from 'path'
import { IncomingHttpHeaders } from 'http'
import { getConfig } from './config'
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import { Actor } from './models/actor'

interface StringMap {
  [key: string]: string
}

export async function parse(signature: string): Promise<StringMap> {
  const grammar = await fs.readFile(
    path.resolve(process.cwd(), 'lib', 'signature.pegjs'),
    'utf-8'
  )
  const parser = generate(grammar)
  try {
    return (parser.parse(signature) as [string, string][]).reduce(
      (out, item) => ({ ...out, [item[0]]: item[1] }),
      {}
    )
  } catch {
    return {}
  }
}

// TODO: Add more checks later https://github.com/mastodon/mastodon/blob/main/app/controllers/concerns/signature_verification.rb#L78
export async function verify(
  requestTarget: string,
  headers: IncomingHttpHeaders,
  publicKey: string
) {
  const headerSignature = await parse(headers.signature as string)
  if (!headerSignature.headers) return false

  const comparedSignedString = headerSignature.headers
    .split(' ')
    .map((item) => {
      if (item === '(request-target)')
        return `(request-target): ${requestTarget}`
      return `${item}: ${headers[item]}`
    })
    .join('\n')

  const signature = headerSignature.signature
  const verifier = crypto.createVerify(headerSignature.algorithm)
  verifier.update(comparedSignedString)
  try {
    return verifier.verify(publicKey, signature, 'base64')
  } catch {
    return false
  }
}

export function sign(
  request: string,
  headers: IncomingHttpHeaders,
  privateKey: string
) {
  const signedString = [
    request,
    `host: ${headers['host']}`,
    `date: ${headers['date']}`,
    `digest: ${headers['digest']}`,
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

export function headers(
  currentActor: Actor,
  method: string,
  targetUrl: string,
  content: any
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

import crypto from 'crypto'
import { generate } from 'peggy'
import fs from 'fs/promises'
import path from 'path'

interface StringMap {
  [key: string]: string
}

const SIGNATURE_KEYS = ['keyId', 'algorithm', 'headers', 'signature']

export async function parse(signature: string): Promise<StringMap> {
  const grammar = await fs.readFile(
    path.resolve(__dirname, 'signature.pegjs'),
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
export async function verify(headers: StringMap, publicKey: string) {
  const headerSignature = await parse(headers.signature)
  if (!headerSignature.headers) return

  const comparedSignedString = headerSignature.headers
    .split(' ')
    .map((item) => {
      if (item === '(request-target)') return '(request-target): post /inbox'
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

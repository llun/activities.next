import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

export const createSignedRawPostRequest = ({
  bodyText,
  keyId = 'https://remote.test/users/alice#main-key',
  signatureHeaders = '(request-target) host date digest',
  host = 'activities.local',
  date = new Date().toUTCString()
}: {
  bodyText: string
  keyId?: string
  signatureHeaders?: string
  host?: string
  date?: string
}) => {
  const digest = crypto.createHash('sha256').update(bodyText).digest('base64')

  return new NextRequest('https://activities.local/api/inbox', {
    method: 'POST',
    headers: {
      date,
      digest: `SHA-256=${digest}`,
      ...(host ? { host } : {}),
      signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${signatureHeaders}",signature="signature"`
    },
    body: bodyText
  })
}

export const createSignedPostRequest = ({
  body,
  keyId
}: {
  body: unknown
  keyId?: string
}) =>
  createSignedRawPostRequest({
    bodyText: JSON.stringify(body),
    keyId
  })

import type { NextApiHandler } from 'next'
import { parse, verify } from '../../lib/signature'
import { getStorage } from '../../lib/storage'
import { fromJson } from '../../lib/models/status'
import { getPerson } from '../../lib/activities'

export interface StreamsTag {}

export interface StreamsObjectReplies {
  id: string
  type: 'Collection'
  first: {}
}

export type StreamsObjectType = 'Note'

export interface StreamsObject {
  id: string
  type: StreamsObjectType
  summary: string | null
  inReplyTo: string | null
  published: string
  url: string
  attributedTo: string
  to: string[]
  cc: string[]
  sensitive: boolean
  atomUri: string
  inReplyToAtomUri: string | null
  conversation: string
  content: string
  contentMap: {
    [key: string]: string
  }
  attachment: string[]
  tag: StreamsTag[]
  replies: StreamsObjectReplies
}

export interface StreamsSignature {
  type: 'string'
  creator: string
  created: string
  signatureValue: string
}

export type StreamType = 'Create'

export interface StreamsJSON {
  id: 'https://glasgow.social/users/llun/statuses/109321528195480284/activity'
  type: StreamType
  actor: string
  published: string // published time
  to: string[]
  cc: string[]
  object: StreamsObject
  signature: StreamsSignature
}

const ApiHandler: NextApiHandler = async (req, res) => {
  const headerSignature = req.headers.signature
  if (!headerSignature) {
    return res.status(400).send('Bad request')
  }

  const signatureParts = await parse(headerSignature as string)
  if (!signatureParts.keyId) {
    return res.status(400).send('Bad request')
  }

  const sender = await getPerson(signatureParts.keyId, false)
  if (!sender) {
    return res.status(400).send('Bad request')
  }

  if (!verify('post /inbox', req.headers, sender.publicKey)) {
    return res.status(400).send('Bad request')
  }

  const body = JSON.parse(req.body) as StreamsJSON
  const storage = await getStorage()
  switch (body.type) {
    case 'Create': {
      storage?.createStatus(fromJson(body.object))
      return res.status(202).send('')
    }
    default:
      res.status(404).send('Unsupported')
  }
}
export default ApiHandler

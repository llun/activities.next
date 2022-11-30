import * as jsonld from 'jsonld'

import { Status, toObject } from '../../models/status'
import { getISOTimeUTC } from '../../time'
import { ContextEntity } from '../entities/base'
import { Mention } from '../entities/mention'
import { Note } from '../entities/note'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'

export interface CreateStatus extends BaseActivity, ContextEntity {
  type: 'Create'
  published: string
  to: string[]
  cc: string[]
  object: Note | Question
  signature?: Signature
}

interface CompactParams {
  status: Status
  mentions?: Mention[]
  replyStatus?: Status
}
export const compact = ({ status, mentions, replyStatus }: CompactParams) => {
  const published = getISOTimeUTC(status.createdAt)
  const context = { '@context': 'https://www.w3.org/ns/activitystreams' }
  const document = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${status.id}/activity`,
    type: 'Create',
    actor: status.actorId,
    published,
    to: status.to,
    cc: status.cc,
    object: toObject({ status, mentions, replyStatus })
  }
  return jsonld.compact(document, context)
}

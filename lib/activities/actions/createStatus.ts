import * as jsonld from 'jsonld'

import { Status } from '../../models/status'
import { getISOTimeUTC } from '../../time'
import { ContextEntity } from '../entities/base'
import { Note } from '../entities/note'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'

export interface CreateStatus extends BaseActivity, ContextEntity {
  type: 'Create'
  published: string
  to: string | string[]
  cc: string | string[]
  object: Note | Question
  signature?: Signature
}

interface CompactParams {
  status: Status
}
export const compact = ({ status }: CompactParams) => {
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
    object: status.toObject
  }
  return jsonld.compact(document, context)
}

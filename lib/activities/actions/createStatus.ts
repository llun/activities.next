import { Note, Question } from '@llun/activities.schema'
import * as jsonld from 'jsonld'

import { BaseActivity } from '@/lib/activities/actions/base'
import { CreateAction } from '@/lib/activities/actions/types'
import { ContextEntity } from '@/lib/activities/entities/base'
import { Signature } from '@/lib/activities/types'
import { Status, toMastodonObject } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export interface CreateStatus extends BaseActivity, ContextEntity {
  type: CreateAction
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
    type: CreateAction,
    actor: status.actorId,
    published,
    to: status.to,
    cc: status.cc,
    object: toMastodonObject(status)
  }
  return jsonld.compact(document, context)
}

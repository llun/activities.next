import { Note } from '@llun/activities.schema'
import * as jsonld from 'jsonld'

import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { Status } from '../../models/status'
import { ContextEntity } from '../entities/base'
import { Question } from '../entities/question'
import { Signature } from '../types'
import { BaseActivity } from './base'
import { CreateAction } from './types'

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
  const published = getISOTimeUTC(status.data.createdAt)
  const context = { '@context': 'https://www.w3.org/ns/activitystreams' }
  const document = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${status.data.id}/activity`,
    type: CreateAction,
    actor: status.data.actorId,
    published,
    to: status.data.to,
    cc: status.data.cc,
    object: status.toObject()
  }
  return jsonld.compact(document, context)
}

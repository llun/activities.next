import * as jsonld from 'jsonld'

import { ContextEntity } from '../entities/base'
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

export const compact = () => {
  const context = { '@context': 'https://www.w3.org/ns/activitystreams' }
  const document = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    '@type': 'Create',
    '@id': 'https://llun.me/test',
    object: {
      '@id': 'https://llun.me/test/note',
      '@type': 'https://www.w3.org/ns/activitystreams#Note',
      name: 'A Simple Note',
      content: 'This is a simple note',
      published: '2015-01-25T12:34:56Za'
    }
  }
  return jsonld.compact(document, context)
}

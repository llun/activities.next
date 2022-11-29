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
  const context = 'https://www.w3.org/ns/activitystreams'
  const document = {
    '@type': 'https://www.w3.org/ns/activitystreams#Create',
    '@id': 'test',
    'https://www.w3.org/ns/activitystreams#published': '2014-12-12T12:12:12Z',
    'https://www.w3.org/ns/activitystreams#object': {
      '@id': 'test/note',
      '@type': 'https://www.w3.org/ns/activitystreams#Note',
      'https://www.w3.org/ns/activitystreams#name': 'A Simple Note',
      'https://www.w3.org/ns/activitystreams#content': 'This is a simple note',
      'https://www.w3.org/ns/activitystreams#published': '2014-12-12T12:12:12Z'
    }
  }
  return jsonld.compact(document, context)
}

import { ContextEntity } from './base'
import { Collection } from './collection'
import { Document } from './document'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

type Attachment = PropertyValue | Document

export interface BaseNote extends ContextEntity {
  id: string
  summary: null
  inReplyTo: string | null
  published: string
  url: string
  attributedTo: string
  to: string | string[]
  cc: string | string[]
  content: string
  attachment: Attachment | Attachment[]
  tag: Mention[]
  replies: Collection
}

export interface Note extends BaseNote {
  type: 'Note'
}

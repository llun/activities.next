import { ContextEntity } from './base'
import { Collection } from './collection'
import { Document } from './document'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

export type Attachment = PropertyValue | Document

export interface BaseNote extends ContextEntity {
  id: string
  summary: string | null
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

export const getAttachments = (object: Note) => {
  if (!object.attachment) return null
  if (Array.isArray(object.attachment)) return object.attachment
  return [object.attachment]
}

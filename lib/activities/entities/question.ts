import { ContextEntity } from './base'
import { Collection } from './collection'
import { Emoji } from './emoji'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

export type Attachment = PropertyValue | Document

export const NoteEntity = 'Note'
export type NoteEntity = typeof NoteEntity

export interface BaseNote extends ContextEntity {
  id: string
  summary?: string
  summaryMap?: {
    [key in string]: string
  }
  inReplyTo: string | null
  published: string
  updated?: string
  url: string
  attributedTo: string
  to: string | string[]
  cc: string | string[]
  content?: string
  contentMap?: {
    [key in string]: string
  }
  attachment?: Attachment | Attachment[]
  tag: (Mention | Emoji)[]
  replies?: Collection
}

export const QuestionEntity = 'Question'
export type QuestionEntity = typeof QuestionEntity

export interface QuestionNote {
  type: NoteEntity
  name: string
  replies: { type: 'Collection'; totalItems: number }
}

export interface Question extends BaseNote {
  type: QuestionEntity
  endTime: string
  oneOf: QuestionNote[]
}

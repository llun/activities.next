import { Collection } from './collection'
import { Document } from './document'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

export interface BaseNote {
  id: string
  summary: null
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
    [locale: string]: string
  }
  attachment: (PropertyValue | Document)[]
  tag: Mention[]
  replies: Collection
}

export interface Note extends BaseNote {
  type: 'Note'
}

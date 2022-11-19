import { Collection } from './collection'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

export interface BaseNote {
  id: string
  summary: null
  inReplyTo: string
  published: string
  url: string
  attributedTo: string
  to: string[]
  cc: string[]
  sensitive: boolean
  atomUri: string
  inReplyToAtomUri: string
  conversation: string
  content: string
  contentMap: {
    [locale: string]: string
  }
  attachment: PropertyValue[]
  tag: Mention[]
  replies: Collection
}

export interface Note extends BaseNote {
  type: 'Note'
}

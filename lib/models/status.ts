import { StreamsObject } from '../../pages/api/inbox'
import { Account } from './account'

export type Visibility = 'public' | 'unlisted' | 'private' | 'direct'

// https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
export interface Status {
  uri: string
  url: string
  account?: Account
  text: string
  summary: string | null

  createdAt: number
  updatedAt?: number

  reply: string
  sensitive: boolean
  visibility: Visibility
  language?: string

  thread?: string
  converstion: string
  media_attachment_ids: string[]
}

export const fromJson = (data: StreamsObject): Status => ({
  uri: data.id,
  url: data.url || data.id,
  text: data.content,
  summary: data.summary,

  createdAt: new Date(data.published).getTime(),

  reply: data.replies.id,
  sensitive: data.sensitive,
  visibility: 'public',
  language: Object.keys(data.contentMap).shift(),

  converstion: data.conversation,
  media_attachment_ids: []
})

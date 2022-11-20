import { Note } from '../activities/entities/note'
import { Question } from '../activities/entities/question'

export type Visibility = 'public' | 'unlisted' | 'private' | 'direct'

// https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
export interface Status {
  id: string
  url: string

  actorId: string

  type: 'Note' | 'Question'
  text: string
  summary: string | null

  createdAt: number
  updatedAt?: number

  to: string[]
  cc: string[]

  reply: string
  sensitive: boolean
  visibility: Visibility
  language?: string

  thread?: string
  conversation: string
  mediaAttachmentIds: string[]
}

export const fromJson = (data: Note | Question): Status => ({
  id: data.id,
  url: data.url || data.id,

  actorId: data.attributedTo,

  type: data.type,
  text: data.content,
  summary: data.summary,

  to: data.to,
  cc: data.cc,

  createdAt: new Date(data.published).getTime(),

  reply: data.replies.id,
  sensitive: data.sensitive,
  visibility: 'public',
  language: Object.keys(data.contentMap).shift(),

  conversation: data.conversation,
  mediaAttachmentIds: []
})

import { Account } from './account'

export type Visibility = 'public' | 'unlisted' | 'private' | 'direct'

// https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
export interface Status {
  uri: string
  url: string
  account: Account
  text: string
  summary: string // spoiler_text

  createdAt: number // created_at
  updatedAt: number // edited_at

  reply: string // inReplyTo
  sensitive: boolean // ? object.sensitive flag
  visibility: Visibility
  language: string

  thread?: string
  converstion: string
  media_attachment_ids: string[]
}

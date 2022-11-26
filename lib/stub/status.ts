import { Status } from '../models/status'

interface Params {
  conversation?: string
  text: string
  createdAt?: number
}
export const MockStatus = ({
  conversation,
  text,
  createdAt = Date.now()
}: Params): Status => ({
  language: 'th',
  type: 'Note',
  conversation: conversation ?? `conversation-${createdAt}`,
  text,
  summary: null,
  url: 'https://earth.social/@thai/109408808043120672',
  sensitive: false,
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  actorId: 'https://earth.social/users/thai',
  visibility: 'public',
  id: 'https://earth.social/users/thai/statuses/109408808043120672',
  cc: [
    'https://earth.social/users/thai/followers',
    'https://llun.dev/users/null'
  ],
  createdAt,
  reply: 'https://earth.social/users/thai/statuses/109408808043120672/replies',
  mediaAttachmentIds: []
})

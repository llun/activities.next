import { Status } from '../models/status'

interface Params {
  text: string
  createdAt?: number
}
export const MockStatus = ({
  text,
  createdAt = Date.now()
}: Params): Status => ({
  type: 'Note',
  text,
  summary: null,
  url: 'https://earth.social/@thai/109408808043120672',
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  actorId: 'https://earth.social/users/thai',
  id: 'https://earth.social/users/thai/statuses/109408808043120672',
  cc: [
    'https://earth.social/users/thai/followers',
    'https://llun.dev/users/null'
  ],
  localRecipients: [],
  createdAt,
  reply: 'https://earth.social/users/thai/statuses/109408808043120672/replies'
})

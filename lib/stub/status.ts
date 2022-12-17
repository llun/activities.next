import { Status } from '../models/status'

interface Params {
  text: string
  id?: string
  createdAt?: number
  reply?: string | null
}
export const MockStatus = ({
  id = 'https://earth.social/users/thai/statuses/109408808043120672',
  text,
  createdAt = Date.now(),
  reply = null
}: Params): Status => ({
  type: 'Note',
  text,
  summary: null,
  url: 'https://earth.social/@thai/109408808043120672',
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  actorId: 'https://earth.social/users/thai',
  id,
  cc: [
    'https://earth.social/users/thai/followers',
    'https://llun.dev/users/null'
  ],
  localRecipients: [],
  createdAt,
  reply
})

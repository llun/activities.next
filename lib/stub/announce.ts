import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { AnnounceStatus } from '../activities/actions/announceStatus'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../utils/jsonld/activitystream'

interface Params {
  actorId: string
  statusId: string
  announceStatusId: string
  published?: number
}
export const MockAnnounceStatus = ({
  actorId,
  statusId,
  announceStatusId,
  published = Date.now()
}: Params): AnnounceStatus => {
  const url = new URL(announceStatusId)
  const announceOwnerIdPathname = url.pathname.slice(
    0,
    url.pathname.indexOf('/statuses')
  )
  const announceOwnerId = `${url.origin}${announceOwnerIdPathname}`

  return {
    '@context': ACTIVITY_STREAM_URL,
    id: `${statusId}/activity`,
    type: 'Announce',
    actor: actorId,
    published: getISOTimeUTC(published),
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [announceOwnerId, `${actorId}/followers`],
    object: announceStatusId
  }
}

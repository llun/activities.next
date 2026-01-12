import { Actor } from '@llun/activities.schema'

import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

const W3ID_SECURITY_URL = 'https://w3id.org/security/v1'

interface Params {
  id: string
  url?: string
  createdAt?: number
  withContext?: boolean
  sharedInboxUrl?: string | null
  includeSharedInbox?: boolean
}
export const MockPerson = ({
  id,
  url,
  createdAt = Date.now(),
  sharedInboxUrl
}: Params) => {
  const userUrl = new URL(id)
  const username = userUrl.pathname.split('/').pop()
  return {
    id,
    username,
    url: url ?? `https://${userUrl.host}/@${username}`,
    domain: userUrl.host,

    endpoints: {
      following: `${id}/following`,
      followers: `${id}/followers`,
      inbox: `${id}/inbox`,
      outbox: `${id}/outbox`,
      sharedInbox: sharedInboxUrl ?? `https://${new URL(id).hostname}/inbox`
    },

    createdAt
  }
}

export const MockActivityPubPerson = ({
  id,
  url,
  createdAt = Date.now(),
  withContext = true,
  sharedInboxUrl,
  includeSharedInbox
}: Params): Actor => {
  const userUrl = new URL(id)
  const username = userUrl.pathname.split('/').pop()
  const isNoSharedInboxHost = userUrl.hostname === 'no.shared.inbox'
  const shouldIncludeSharedInbox =
    includeSharedInbox ?? (sharedInboxUrl !== null && !isNoSharedInboxHost)
  const resolvedSharedInbox =
    sharedInboxUrl === undefined
      ? `https://${userUrl.host}/inbox`
      : sharedInboxUrl

  if (!shouldIncludeSharedInbox) {
    return {
      ...(withContext
        ? { '@context': [ACTIVITY_STREAM_URL, W3ID_SECURITY_URL] }
        : null),
      id,
      type: 'Person',
      following: `${id}/following`,
      followers: `${id}/followers`,
      inbox: `${id}/inbox`,
      outbox: `${id}/outbox`,
      preferredUsername: username || '',
      name: '',
      summary: '',
      url: url ?? `https://${userUrl.host}/@${username}`,
      published: getISOTimeUTC(createdAt),
      publicKey: {
        id: `${id}#main-key`,
        owner: id,
        publicKeyPem: 'public key'
      }
    }
  }

  return {
    ...(withContext
      ? { '@context': [ACTIVITY_STREAM_URL, W3ID_SECURITY_URL] }
      : null),
    id,
    type: 'Person',
    following: `${id}/following`,
    followers: `${id}/followers`,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    preferredUsername: username || '',
    name: '',
    summary: '',
    url: url ?? `https://${userUrl.host}/@${username}`,
    published: getISOTimeUTC(createdAt),
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: 'public key'
    },
    ...(resolvedSharedInbox
      ? { endpoints: { sharedInbox: resolvedSharedInbox } }
      : null)
  }
}

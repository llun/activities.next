import { Person } from '../activities/entities/person'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { W3ID_URL } from '../jsonld/w3id'
import { getISOTimeUTC } from '../time'

interface Params {
  id: string
  url?: string
  createdAt?: number
}
export const MockPerson = ({ id, url, createdAt = Date.now() }: Params) => {
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
      sharedInbox: `https://${new URL(id).hostname}/inbox`
    },

    createdAt
  }
}

export const MockActivityPubPerson = ({
  id,
  url,
  createdAt = Date.now()
}: Params): Person => {
  const userUrl = new URL(id)
  const username = userUrl.pathname.split('/').pop()

  if (id.startsWith('https://no.shared.inbox')) {
    return {
      '@context': [ACTIVITY_STREAM_URL, W3ID_URL],
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
    '@context': [ACTIVITY_STREAM_URL, W3ID_URL],
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
    endpoints: { sharedInbox: `https://${userUrl.host}/inbox` }
  }
}

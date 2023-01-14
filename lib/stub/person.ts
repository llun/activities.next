import { Person } from '../activities/entities/person'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'
import { W3ID_URL } from '../jsonld/w3id'
import { getISOTimeUTC } from '../time'

interface Params {
  id: string
  createdAt?: number
}
export const MockPerson = ({ id, createdAt = Date.now() }: Params) => {
  const url = new URL(id)
  const username = url.pathname.split('/').pop()
  return {
    id,
    username,
    url: `https://${url.host}/@${username}`,

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
  createdAt = Date.now()
}: Params): Person => {
  const url = new URL(id)
  const username = url.pathname.split('/').pop()

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
      url: `https://${url.host}/@${username}`,
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
    url: `https://${url.host}/@${username}`,
    published: getISOTimeUTC(createdAt),
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: 'public key'
    },
    endpoints: { sharedInbox: `https://${url.host}/inbox` }
  }
}

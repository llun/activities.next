import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getRemoteStatus } from './getRemoteStatus'

enableFetchMocks()

const PUBLIC_STREAM = 'https://www.w3.org/ns/activitystreams#Public'
const ACTOR_ID = 'https://remote.example/users/alice'
const STATUS_ID = 'https://remote.example/users/alice/statuses/1'

describe('#getRemoteStatus', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('fetches a public remote status without persisting it', async () => {
    fetchMock.mockResponse(async (req) => {
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          url: [
            'https://remote.example/@alice/1',
            {
              href: 'at://did:plc:alice/app.bsky.feed.post/1',
              rel: 'canonical',
              type: 'Link'
            }
          ],
          attributedTo: ACTOR_ID,
          content: 'Hello from a remote profile',
          to: [PUBLIC_STREAM],
          cc: [`${ACTOR_ID}/followers`],
          published: new Date('2026-04-30T12:00:00.000Z').toISOString()
        })
      }

      if (req.url === ACTOR_ID) {
        return JSON.stringify({
          id: ACTOR_ID,
          type: 'Person',
          preferredUsername: 'alice',
          name: 'Alice',
          inbox: `${ACTOR_ID}/inbox`,
          outbox: `${ACTOR_ID}/outbox`,
          followers: `${ACTOR_ID}/followers`,
          publicKey: {
            id: `${ACTOR_ID}#main-key`,
            owner: ACTOR_ID,
            publicKeyPem: 'public key'
          }
        })
      }

      return { status: 404, body: 'Not Found' }
    })

    await expect(
      getRemoteStatus({ statusId: STATUS_ID })
    ).resolves.toMatchObject({
      id: STATUS_ID,
      actorId: ACTOR_ID,
      actor: {
        id: ACTOR_ID,
        username: 'alice',
        domain: 'remote.example',
        name: 'Alice'
      },
      text: 'Hello from a remote profile',
      url: 'https://remote.example/@alice/1'
    })
  })

  it('does not return non-public remote statuses', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: STATUS_ID,
        type: 'Note',
        attributedTo: ACTOR_ID,
        content: 'Private remote status',
        to: [ACTOR_ID],
        cc: [],
        published: new Date('2026-04-30T12:00:00.000Z').toISOString()
      })
    )

    await expect(getRemoteStatus({ statusId: STATUS_ID })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

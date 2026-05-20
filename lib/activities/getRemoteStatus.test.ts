import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { StatusType } from '@/lib/types/domain/status'

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

  it('fetches public remote statuses with object-shaped audience entries', async () => {
    fetchMock.mockResponse(async (req) => {
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: ACTOR_ID,
          content: 'Hello with object audience',
          to: [
            {
              id: PUBLIC_STREAM,
              type: 'Collection'
            }
          ],
          cc: [],
          published: new Date('2026-04-30T12:00:00.000Z').toISOString()
        })
      }

      if (req.url === ACTOR_ID) {
        return { status: 503, body: 'Unavailable' }
      }

      return { status: 404, body: 'Not Found' }
    })

    await expect(
      getRemoteStatus({ statusId: STATUS_ID })
    ).resolves.toMatchObject({
      id: STATUS_ID,
      actorId: ACTOR_ID,
      actor: null,
      text: 'Hello with object audience'
    })
  })

  it('fetches a public remote poll without persisting it', async () => {
    fetchMock.mockResponse(async (req) => {
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Question',
          url: 'https://remote.example/@alice/polls/1',
          attributedTo: ACTOR_ID,
          content: 'Pick one',
          to: [PUBLIC_STREAM],
          cc: [`${ACTOR_ID}/followers`],
          oneOf: [
            {
              type: 'Note',
              name: 'One',
              replies: {
                type: 'Collection',
                totalItems: 3
              }
            },
            {
              type: 'Note',
              name: 'Two',
              replies: {
                type: 'Collection',
                totalItems: 1
              }
            }
          ],
          endTime: new Date('2026-05-01T12:00:00.000Z').toISOString(),
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
      type: StatusType.enum.Poll,
      text: 'Pick one',
      url: 'https://remote.example/@alice/polls/1',
      pollType: 'oneOf',
      choices: [
        {
          title: 'One',
          totalVotes: 3
        },
        {
          title: 'Two',
          totalVotes: 1
        }
      ]
    })
  })

  it('defaults missing remote poll vote counts to zero', async () => {
    fetchMock.mockResponse(async (req) => {
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Question',
          attributedTo: ACTOR_ID,
          content: 'Pick one',
          to: [PUBLIC_STREAM],
          cc: [`${ACTOR_ID}/followers`],
          oneOf: [
            {
              type: 'Note',
              name: 'One'
            },
            {
              type: 'Note',
              name: 'Two',
              replies: null
            }
          ],
          published: new Date('2026-04-30T12:00:00.000Z').toISOString()
        })
      }

      if (req.url === ACTOR_ID) {
        return { status: 503, body: 'Unavailable' }
      }

      return { status: 404, body: 'Not Found' }
    })

    await expect(
      getRemoteStatus({ statusId: STATUS_ID })
    ).resolves.toMatchObject({
      type: StatusType.enum.Poll,
      choices: [
        {
          title: 'One',
          totalVotes: 0
        },
        {
          title: 'Two',
          totalVotes: 0
        }
      ]
    })
  })

  it('does not return unsupported remote objects', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: STATUS_ID,
        type: 'Announce',
        actor: ACTOR_ID,
        object: `${ACTOR_ID}/statuses/2`,
        to: [PUBLIC_STREAM],
        cc: [],
        published: new Date('2026-04-30T12:00:00.000Z').toISOString()
      })
    )

    await expect(getRemoteStatus({ statusId: STATUS_ID })).resolves.toBeNull()
  })

  it('does not return malformed remote notes', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: STATUS_ID,
        type: 'Note',
        attributedTo: ACTOR_ID,
        content: [],
        to: [PUBLIC_STREAM],
        cc: [],
        published: new Date('2026-04-30T12:00:00.000Z').toISOString()
      })
    )

    await expect(getRemoteStatus({ statusId: STATUS_ID })).resolves.toBeNull()
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

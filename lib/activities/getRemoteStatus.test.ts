import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getRemoteStatus } from './getRemoteStatus'

enableFetchMocks()

const PUBLIC_STREAM = 'https://www.w3.org/ns/activitystreams#Public'
const ACTOR_ID = 'https://remote.example/users/alice'
const STATUS_ID = 'https://remote.example/users/alice/statuses/1'

describe('getRemoteStatus', () => {
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

  it('attaches a content-detected language to the ephemeral status', async () => {
    fetchMock.mockResponse(async (req) => {
      if (req.url === STATUS_ID) {
        return JSON.stringify({
          id: STATUS_ID,
          type: 'Note',
          attributedTo: ACTOR_ID,
          // Declared English via the default contentMap-less `content`, but
          // the content itself is unambiguously Thai.
          content:
            'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
          to: [PUBLIC_STREAM],
          cc: [`${ACTOR_ID}/followers`],
          published: new Date('2026-04-30T12:00:00.000Z').toISOString()
        })
      }

      return { status: 404, body: 'Not Found' }
    })

    await expect(
      getRemoteStatus({ statusId: STATUS_ID })
    ).resolves.toMatchObject({
      id: STATUS_ID,
      language: null,
      detectedLanguage: 'th'
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

  it('does not return non-Note remote objects', async () => {
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

import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusSource } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/statuses/[id]/source', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns the StatusSource shape { id, text, spoiler_text }', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-shape`
    const status = await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'The plain-text source of the status',
      summary: 'A content warning',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    // The request still used the legacy colon-form id; the response echoes the
    // publicId the status entity carries everywhere else.
    expect(data).toEqual({
      id: status.publicId,
      text: 'The plain-text source of the status',
      spoiler_text: 'A content warning'
    })
  })

  it('returns an empty spoiler_text when the status has no content warning', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-no-cw`
    const status = await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'No content warning here',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      id: status.publicId,
      text: 'No content warning here',
      spoiler_text: ''
    })
  })

  it('returns plain text rather than stored HTML for a Bluesky post', async () => {
    const did = `did:plc:${'s'.repeat(24)}`
    const blueskyActorId = (await database.upsertBlueskyActor({
      did,
      handle: 'sourceuser.bsky.social'
    })) as string
    const { statusId } = await database.upsertBlueskyPost({
      uri: `at://${did}/app.bsky.feed.post/src1`,
      cid: 'cid-src1',
      did,
      rkey: 'src1',
      actorId: blueskyActorId,
      text: '<p>First line<br>See <a href="https://example.com/full/path" rel="nofollow noopener noreferrer" target="_blank">example.com/full...</a></p><p><a href="https://example.com/card" rel="nofollow noopener noreferrer" target="_blank">Card title</a></p>',
      createdAt: Date.now(),
      attachments: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.text).toBe(
      'First line\nSee https://example.com/full/path\n\nCard title https://example.com/card'
    )
    expect(data.text).not.toContain('<p>')
    expect(data.text).not.toContain('<br>')
    expect(data.text).not.toContain('<a ')
  })

  it('returns plain text without appended bsky.app URLs for Bluesky mention and hashtag facets', async () => {
    const { blueskyPostToHtml } = await import('@/lib/services/bluesky/records')
    const { getMastodonStatus } =
      await import('@/lib/services/mastodon/getMastodonStatus')
    const did = `did:plc:${'m'.repeat(24)}`
    const mentionedDid = `did:plc:${'n'.repeat(24)}`
    const blueskyActorId = (await database.upsertBlueskyActor({
      did,
      handle: 'facetuser.bsky.social'
    })) as string
    const rawText = 'Hi @bob.bsky.social love #fediverse'
    const mentionStart = Buffer.byteLength('Hi ')
    const mentionEnd = mentionStart + Buffer.byteLength('@bob.bsky.social')
    const tagStart = Buffer.byteLength('Hi @bob.bsky.social love ')
    const tagEnd = tagStart + Buffer.byteLength('#fediverse')
    const html = blueskyPostToHtml(rawText, [
      {
        index: { byteStart: mentionStart, byteEnd: mentionEnd },
        features: [
          { $type: 'app.bsky.richtext.facet#mention', did: mentionedDid }
        ]
      },
      {
        index: { byteStart: tagStart, byteEnd: tagEnd },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'fediverse' }]
      }
    ])
    const { statusId } = await database.upsertBlueskyPost({
      uri: `at://${did}/app.bsky.feed.post/facet1`,
      cid: 'cid-facet1',
      did,
      rkey: 'facet1',
      actorId: blueskyActorId,
      text: html,
      createdAt: Date.now(),
      attachments: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.text).toBe('Hi @bob.bsky.social love #fediverse')

    const storedStatus = await database.getStatus({ statusId })
    expect(storedStatus).not.toBeNull()
    const mastodonStatus = await getMastodonStatus(
      database,
      storedStatus!,
      ACTOR1_ID
    )
    expect(mastodonStatus?.text).toBe('Hi @bob.bsky.social love #fediverse')
  })

  it('returns 404 for a non-existent status', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-missing`
    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(404)
  })
})

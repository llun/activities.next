import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import {
  MOCK_PRIVATE_KEY,
  MOCK_SECRET_PHASES,
  MockActor
} from '@/lib/stub/actor'
import { seedDatabase } from '@/lib/stub/database'
import {
  FEDIVERSE_ACTIVITIES,
  FEDIVERSE_ACTORS,
  mockFediverseRequests
} from '@/lib/stub/fediverse'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { signHttpMessage } from '@/lib/utils/httpMessageSignature'
import { signedHeaders } from '@/lib/utils/signature'

import { POST } from './route'

enableFetchMocks()

const { mockPublish, testDatabase } = vi.hoisted(() => ({
  mockPublish: vi.fn(),
  testDatabase: { current: null as Database | null }
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => testDatabase.current
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const mastodonSender = MockActor({
  id: FEDIVERSE_ACTORS.mastodon.id,
  sharedInboxUrl: FEDIVERSE_ACTORS.mastodon.endpoints.sharedInbox
})

const getInboxUrl = () => `https://${getConfig().host}/api/inbox`

const postSigned = async ({
  body,
  headers
}: {
  body: string
  headers: Record<string, string>
}) =>
  POST(
    new NextRequest(getInboxUrl(), {
      method: 'POST',
      headers,
      body
    }),
    { params: Promise.resolve({}) }
  )

describe('shared inbox signed delivery', () => {
  let database: Database

  beforeEach(async () => {
    const created = createTestDatabase()
    database = created.database
    await created.prepare()
    await database.migrate()
    await seedDatabase(database)
    testDatabase.current = database
    mockPublish.mockReset()
    fetchMock.resetMocks()
    mockFediverseRequests(fetchMock)
  })

  afterEach(async () => {
    vi.useRealTimers()
    testDatabase.current = null
    await database.destroy()
  })

  it('accepts a draft-cavage signed delivery and publishes the job', async () => {
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const headers = signedHeaders(mastodonSender, 'POST', getInboxUrl(), body)

    const response = await postSigned({ body, headers })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: CREATE_NOTE_JOB_NAME,
        verifiedSenderActorId: FEDIVERSE_ACTORS.mastodon.id
      })
    )
  })

  it('accepts an RFC 9421 signed delivery and publishes the job', async () => {
    const inboxUrl = getInboxUrl()
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const signed = signHttpMessage({
      body,
      keyId: FEDIVERSE_ACTORS.mastodon.publicKey.id,
      method: 'POST',
      passphrase: MOCK_SECRET_PHASES,
      privateKey: MOCK_PRIVATE_KEY,
      url: inboxUrl
    })

    const response = await postSigned({
      body,
      headers: {
        host: new URL(inboxUrl).host,
        ...signed.headers
      }
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: CREATE_NOTE_JOB_NAME,
        verifiedSenderActorId: FEDIVERSE_ACTORS.mastodon.id
      })
    )
  })

  it('rejects a tampered body whose digest does not match', async () => {
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const headers = signedHeaders(mastodonSender, 'POST', getInboxUrl(), body)
    const tamperedBody = JSON.stringify({
      ...FEDIVERSE_ACTIVITIES.mastodonCreateNote,
      id: `${FEDIVERSE_ACTIVITIES.mastodonCreateNote.id}-tampered`
    })

    const response = await postSigned({ body: tamperedBody, headers })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('rejects a request signed with the wrong private key', async () => {
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const wrongKeySender = {
      ...mastodonSender,
      privateKey: seedActor1.privateKey
    }
    const headers = signedHeaders(wrongKeySender, 'POST', getInboxUrl(), body)

    const response = await postSigned({ body, headers })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('rejects a signature computed over a different request target', async () => {
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const otherUrl = `https://${getConfig().host}/api/other`
    const headers = signedHeaders(mastodonSender, 'POST', otherUrl, body)

    const response = await postSigned({ body, headers })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('rejects a request with no signature headers', async () => {
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)

    const response = await postSigned({
      body,
      headers: {
        'content-type': 'application/activity+json',
        host: new URL(getInboxUrl()).host
      }
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('rejects a draft-cavage request with a stale Date outside the 12h+1h window', async () => {
    const now = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(now - 14 * 60 * 60 * 1000)
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const headers = signedHeaders(mastodonSender, 'POST', getInboxUrl(), body)
    vi.setSystemTime(now)

    const response = await postSigned({ body, headers })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('rejects an RFC 9421 request with a stale created timestamp outside the 12h+1h window', async () => {
    const inboxUrl = getInboxUrl()
    const body = JSON.stringify(FEDIVERSE_ACTIVITIES.mastodonCreateNote)
    const staleCreatedSec = Math.floor(Date.now() / 1000) - 14 * 60 * 60
    const signed = signHttpMessage({
      body,
      createdSec: staleCreatedSec,
      keyId: FEDIVERSE_ACTORS.mastodon.publicKey.id,
      method: 'POST',
      passphrase: MOCK_SECRET_PHASES,
      privateKey: MOCK_PRIVATE_KEY,
      url: inboxUrl
    })

    const response = await postSigned({
      body,
      headers: {
        host: new URL(inboxUrl).host,
        ...signed.headers
      }
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

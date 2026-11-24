import { renderToStaticMarkup } from 'react-dom/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { getPublicPostThread } from '@/lib/services/bluesky/appview'
import {
  blueskyPostId,
  parseBlueskyPostView,
  storeBlueskyPostView
} from '@/lib/services/bluesky/records'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { PagedStatusThread } from './PagedStatusThread'
import Page from './page'

let mockDatabase: Database | null = null
const mockGetServerAuthSession = vi.fn()

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers())
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => `https://${TEST_DOMAIN}`,
  getConfig: () => ({
    host: TEST_DOMAIN,
    mediaStorage: undefined,
    fitnessStorage: undefined
  })
}))

vi.mock('@/lib/config/mapProvider', () => ({
  getPublicMapProvider: () => ({ type: 'osm' })
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn(async () => ({
    domain: TEST_DOMAIN,
    displayName: 'Activities',
    source: 'primary',
    open: true,
    allowEmails: []
  }))
}))

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicPostThread: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: vi.fn().mockResolvedValue(undefined),
    runsInline: false
  })
}))

vi.mock('@/lib/components/layout/mobile-compact-header', () => ({
  MobileCompactHeader: () => null
}))
vi.mock('./Header', () => ({ Header: () => null }))
vi.mock('./StatusLikes', () => ({ StatusLikes: () => null }))
vi.mock('./SignInCallout', () => ({ SignInCallout: () => null }))
vi.mock('./PagedStatusThread', () => ({
  PagedStatusThread: vi.fn(() => null)
}))

const did = (name: string) => `did:plc:${name.padEnd(24, 'a')}`

const bskyPostView = (
  name: string,
  rkey: string,
  text: string,
  parentUri?: string
) => ({
  uri: `at://${did(name)}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: {
    did: did(name),
    handle: `${name}.bsky.social`,
    displayName: name.toUpperCase()
  },
  record: {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(parentUri
      ? { reply: { root: { uri: parentUri }, parent: { uri: parentUri } } }
      : null)
  },
  indexedAt: '2026-01-01T00:00:00.000Z'
})

describe('Status page Bluesky thread loading', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let viewer: Actor

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    mockDatabase = database
    await database.createAccount({
      email: `viewer@${TEST_DOMAIN}`,
      username: 'viewer',
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: 'priv-viewer',
      publicKey: 'pub-viewer'
    })
    viewer = (await database.getActorFromId({
      id: `https://${TEST_DOMAIN}/users/viewer`
    })) as Actor
    await database.saveBlueskyAccount({
      actorId: viewer.id,
      did: did('viewer'),
      handle: 'viewer.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getPublicPostThread).mockReset()
    vi.mocked(PagedStatusThread).mockClear()
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: `viewer@${TEST_DOMAIN}` }
    })
  })

  it('loads Bluesky thread parents and replies before reading context for a signed-in viewer', async () => {
    const parent = bskyPostView('parent', 'sp1', 'Parent post')
    const focused = bskyPostView('focus', 'sf1', 'Focused post', parent.uri)
    const reply = bskyPostView('replier', 'sr1', 'Reply post', focused.uri)
    const parsed = parseBlueskyPostView(focused)
    if (!parsed) throw new Error('invalid fixture')
    const focusedId = (await storeBlueskyPostView(database, parsed)) as string

    vi.mocked(getPublicPostThread).mockResolvedValueOnce({
      thread: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: focused,
        parent: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: parent
        },
        replies: [
          {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: reply,
            replies: []
          }
        ]
      }
    })

    const element = await Page({
      params: Promise.resolve({
        actor: '@focus.bsky.social@bsky.app',
        status: encodeURIComponent(focusedId)
      })
    })
    renderToStaticMarkup(element)

    expect(getPublicPostThread).toHaveBeenCalledWith(focused.uri, {
      depth: 6,
      parentHeight: 20
    })
    expect(PagedStatusThread).toHaveBeenCalledTimes(1)
    const threadProps = vi.mocked(PagedStatusThread).mock.calls[0][0]
    expect(threadProps.status.id).toBe(focusedId)
    expect(threadProps.ancestors?.map((item) => item.id)).toEqual([
      blueskyPostId(did('parent'), 'sp1')
    ])
    expect(threadProps.descendants?.map((item) => item.id)).toEqual([
      blueskyPostId(did('replier'), 'sr1')
    ])
  })

  it('does not call AppView for a signed-out viewer or a local non-Bluesky status', async () => {
    const post = bskyPostView('focus', 'sf2', 'Signed out post')
    const parsed = parseBlueskyPostView(post)
    if (!parsed) throw new Error('invalid fixture')
    const focusedId = (await storeBlueskyPostView(database, parsed)) as string

    mockGetServerAuthSession.mockResolvedValueOnce(null)
    await expect(
      Page({
        params: Promise.resolve({
          actor: '@focus.bsky.social@bsky.app',
          status: encodeURIComponent(focusedId)
        })
      })
    ).rejects.toThrow(`NEXT_REDIRECT:${focusedId}`)
    expect(getPublicPostThread).not.toHaveBeenCalled()

    const localId = `${viewer.id}/statuses/local-status-1`
    await database.createNote({
      id: localId,
      url: localId,
      actorId: viewer.id,
      text: 'Local post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const element = await Page({
      params: Promise.resolve({
        actor: `@viewer@${TEST_DOMAIN}`,
        status: 'local-status-1'
      })
    })
    renderToStaticMarkup(element)
    expect(getPublicPostThread).not.toHaveBeenCalled()
  })
})

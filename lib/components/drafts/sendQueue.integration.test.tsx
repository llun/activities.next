/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

import { resetConnectionForTesting } from '@/lib/client/connection'
import {
  announceDraftsChanged,
  getDraft,
  listDrafts,
  pauseQueue,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import {
  DraftsProvider,
  useDrafts
} from '@/lib/components/drafts/DraftsProvider'
import { PostBox } from '@/lib/components/post-box/post-box'
import { profile } from '@/lib/components/post-box/post-box-media.testUtils'
import { EXPECTED_ACTOR_HEADER } from '@/lib/services/statuses/expectedActor'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { DraftsList } from './DraftsList'

// Everything is real (provider, IndexedDB, draftsDb, sendQueue, connection
// store, `createNote`) except the network: `fetch` is a small server below. Only
// the two calls PostBox makes on mount that are not part of the send path are
// stubbed.
vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public')
}))

configure({ asyncUtilTimeout: 4000 })

const ACCOUNT_ID = 'account-1'
const PLACEHOLDER = 'What is on your mind?'

/** What the next POST /api/v1/statuses does; the default is `ok`. */
type PostStep =
  | 'ok'
  // The request never reaches the server (a `TypeError`).
  | 'network'
  // The server creates the status, then the response is lost.
  | 'lost'
  | number

const server = {
  healthy: true,
  steps: [] as PostStep[],
  /** Idempotency-Key -> status id: one entry per status the server made. */
  created: new Map<string, string>(),
  posts: [] as Array<{ key: string | null; actor: string | null }>
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const isPost = url === '/api/v1/statuses' && init?.method === 'POST'
  if (isPost) {
    // Recorded even when it cannot get through: it is an attempt.
    const headers = init.headers as Record<string, string>
    server.posts.push({
      key: headers['Idempotency-Key'] ?? null,
      actor: headers[EXPECTED_ACTOR_HEADER] ?? null
    })
  }
  if (!server.healthy) throw new TypeError('Failed to fetch')
  if (url === '/health') return new Response('ok')
  if (isPost) {
    const key = server.posts.at(-1)?.key ?? null
    const step = server.steps.shift() ?? 'ok'
    if (step === 'network') throw new TypeError('Failed to fetch')
    if (typeof step === 'number') return json({ error: 'Bad request' }, step)
    const id = server.created.get(key ?? '') ?? `status-${server.created.size}`
    server.created.set(key ?? '', id)
    if (step === 'lost') throw new TypeError('Failed to fetch')
    return json({ id, created_at: new Date().toISOString() })
  }
  return json([])
}

const EpochReady = () =>
  useDrafts()?.epoch != null ? <span data-testid="drafts-ready" /> : null

const Tree = () => (
  <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
    <EpochReady />
    <PostBox
      host="activities.local"
      profile={profile}
      isMediaUploadEnabled
      onDiscardReply={vi.fn()}
      onPostCreated={vi.fn()}
      onPostUpdated={vi.fn()}
      onDiscardEdit={vi.fn()}
    />
    <DraftsList
      host="activities.local"
      profile={profile}
      currentTime={Date.now()}
      isMediaUploadEnabled
    />
  </DraftsProvider>
)

const mount = async () => {
  render(<Tree />)
  await screen.findByTestId('drafts-ready')
}

const type = async (text: string) =>
  fireEvent.change((await screen.findAllByPlaceholderText(PLACEHOLDER))[0], {
    target: { value: text }
  })

const goOffline = async () => {
  server.healthy = false
  act(() => void window.dispatchEvent(new Event('offline')))
  await screen.findByRole('button', { name: 'Send when online' })
}

const restoreConnection = () => {
  server.healthy = true
  act(() => void window.dispatchEvent(new Event('online')))
}

const queueIt = async () => {
  const send = await screen.findByRole('button', { name: 'Send when online' })
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.click(send)
}

const stored = async () => (await listDrafts({ actorId: profile.id }))[0]

const nothingStored = () =>
  waitFor(async () => expect(await stored()).toBeUndefined())

// Real IndexedDB needs real microtasks and immediates: only Date and the
// backoff timers are faked, after the composer work is done.
const useFakeClock = () =>
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })

const settle = async () => {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r))
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await settle()
}

describe('the send queue, end to end', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    server.healthy = true
    server.steps = []
    server.created.clear()
    server.posts = []
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetConnectionForTesting()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('sends a post queued offline once, with its key and the expected actor, and deletes the record', async () => {
    await mount()
    await type('Sent when online')
    await goOffline()
    await queueIt()
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('waiting')
    )
    expect(server.posts).toHaveLength(0)

    restoreConnection()

    await nothingStored()
    expect(server.posts).toHaveLength(1)
    expect(server.posts[0].key).toBeTruthy()
    expect(server.posts[0].actor).toBe(profile.id)
    expect(server.created.size).toBe(1)
  })

  it('retries a lost response at the next due time under the same key and makes one status', async () => {
    await mount()
    await type('Lost on the way')
    await goOffline()
    await queueIt()
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('waiting')
    )
    server.steps = ['lost']
    useFakeClock()

    restoreConnection()
    await waitFor(() => expect(server.posts).toHaveLength(1))
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('checking')
    )
    // Backoff for a first attempt is 5 s: nothing goes out before that.
    await advance(4_000)
    expect(server.posts).toHaveLength(1)
    for (let i = 0; i < 6 && server.posts.length < 2; i++) await advance(1_000)

    await nothingStored()
    expect(server.posts).toHaveLength(2)
    expect(server.posts[1].key).toBe(server.posts[0].key)
    expect(server.posts.map((post) => post.actor)).toEqual([
      profile.id,
      profile.id
    ])
    expect(server.created.size).toBe(1)
  })

  it("queues a post the composer already tried under the composer's key", async () => {
    await mount()
    await type('Tried, then queued')
    // The composer's POST fails on the network; its checkpoint is on the draft.
    server.healthy = false
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
    await waitFor(() => expect(server.posts).toHaveLength(1))
    await screen.findByRole('button', { name: 'Send when online' })
    await waitFor(async () => expect((await stored())?.submit).toBeDefined())
    const composerKey = server.posts[0].key

    await queueIt()
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('checking')
    )
    expect((await stored())?.submit?.key).toBe(composerKey)

    restoreConnection()

    await nothingStored()
    expect(server.posts).toHaveLength(2)
    expect(server.posts[1].key).toBe(composerKey)
    expect(server.created.size).toBe(1)
  })

  it('does not send while paused by the user, then sends once Resume is pressed', async () => {
    await mount()
    await type('Paused first')
    await goOffline()
    await queueIt()
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('waiting')
    )
    await pauseQueue({ actorId: profile.id })
    act(() => announceDraftsChanged(ACCOUNT_ID, profile.id, ''))
    await screen.findByText('Paused')

    restoreConnection()
    // Back online, and a drain has had its chance.
    await screen.findByRole('button', { name: 'Post' })
    await settle()
    expect(server.posts).toHaveLength(0)
    expect((await stored())?.queue?.state).toBe('paused')

    fireEvent.click(screen.getByRole('button', { name: /Resume/ }))

    await nothingStored()
    expect(server.posts).toHaveLength(1)
    expect(server.posts[0].actor).toBe(profile.id)
  })

  it('locks a draft after a 400 to an attempt under the same key, and Review opens it locked', async () => {
    await mount()
    await type('Rejected after an attempt')
    await goOffline()
    await queueIt()
    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('waiting')
    )
    server.steps = [400]

    restoreConnection()

    await waitFor(async () =>
      expect((await stored())?.queue?.state).toBe('couldnt_send')
    )
    const failed = await stored()
    expect(server.posts).toHaveLength(1)
    expect(failed.lockedMessage).toBeTruthy()
    expect(failed.submit?.key).toBe(server.posts[0].key)

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))

    // Opened for review: out of the queue, locked, and still under the key.
    await waitFor(async () =>
      expect((await getDraft(failed.id))?.queue).toBe(undefined)
    )
    await waitFor(() =>
      expect(
        screen
          .getAllByPlaceholderText(PLACEHOLDER)
          .some((box) => box.hasAttribute('readonly'))
      ).toBe(true)
    )
    const reviewed = await getDraft(failed.id)
    expect(reviewed?.lockedMessage).toBeTruthy()
    expect(reviewed?.submit?.key).toBe(server.posts[0].key)
  })
})

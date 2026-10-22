/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  type DraftRecord,
  type SendQueueProgress,
  drainQueue,
  getAccountEpoch,
  listDrafts,
  pauseQueue,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resumeQueue,
  runPendingPurges,
  withSenderLock
} from '@/lib/client/drafts'
import { createDeferred } from '@/lib/testing/deferred'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import {
  DraftsProvider,
  RESULT_VISIBLE_MS,
  useDrafts,
  useSendQueueStatus
} from './DraftsProvider'

const connection = vi.hoisted(() => ({
  state: 'online' as 'online' | 'offline' | 'unreachable',
  restore: null as null | (() => void)
}))
const route = vi.hoisted(() => ({ pathname: '/drafts' as string | null }))

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
vi.mock('@/lib/client/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/connection')>()),
  getConnectionSnapshot: () => ({
    state: connection.state,
    nextProbeAt: null,
    probing: false
  }),
  onConnectionRestored: (listener: () => void) => {
    connection.restore = listener
    return () => {
      connection.restore = null
    }
  },
  reportRequestFailure: vi.fn()
}))
// The whole drafts module: the queue functions are stubs until the sender
// lands, and nothing here needs a database.
vi.mock('@/lib/client/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/drafts')>()),
  runPendingPurges: vi.fn(),
  getAccountEpoch: vi.fn(),
  countDrafts: vi.fn(),
  listDrafts: vi.fn(),
  resumeQueue: vi.fn(),
  pauseQueue: vi.fn(),
  drainQueue: vi.fn(),
  withSenderLock: vi.fn()
}))
// The drain's real dependencies are never called here.
vi.mock('@/lib/client/statuses', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  getStatusIfReadable: vi.fn()
}))
vi.mock('@/lib/client/media', () => ({
  uploadAttachment: vi.fn(),
  deleteUnpostedMedia: vi.fn()
}))
vi.mock('@/lib/client/fitnessImports', () => ({ uploadFitnessFile: vi.fn() }))
vi.mock('@/lib/client/fitnessRoutes', () => ({
  deleteUnpostedFitnessFile: vi.fn()
}))
vi.mock('@/lib/client/gallery', () => ({ getGallerySettings: vi.fn() }))

const NOW = new Date('2026-10-22T10:00:00.000Z').getTime()
const ZERO = { attempted: 0, sent: 0, needsReview: 0, failed: 0, paused: 0 }
const IDLE: SendQueueProgress = {
  phase: 'idle',
  index: 0,
  total: 0,
  sent: 0,
  needsReview: 0,
  failed: 0,
  paused: 0
}

const queued = (
  id: string,
  queue: NonNullable<DraftRecord['queue']>
): DraftRecord =>
  ({ id, accountId: 'account-1', actorId: 'actor-1', queue }) as DraftRecord

const Probe = () => {
  const drafts = useDrafts()
  const status = useSendQueueStatus()
  return (
    <div>
      <p data-testid="status">
        {status
          ? `${status.phase} ${status.index}/${status.total} sent=${status.sent}`
          : 'none'}
      </p>
      <button onClick={() => drafts?.requestDrain()}>drain</button>
      <button onClick={() => void status?.pause()}>pause</button>
    </div>
  )
}

const renderProvider = (actorId = 'actor-1') =>
  render(
    <DraftsProvider accountId="account-1" actorId={actorId}>
      <Probe />
    </DraftsProvider>
  )

// The real timer, kept before the fake ones replace it: a dynamic `import()`
// settles on I/O, which microtasks alone never reach.
const realSetTimeout = globalThis.setTimeout

// Lets pending promises and imports settle without moving the fake clock.
const settle = async () => {
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, 15))
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await settle()
}

const post = (message: Parameters<typeof postDraftsMessage>[0]) =>
  act(() => postDraftsMessage(message))

const progressMessage = (
  progress: Partial<SendQueueProgress>,
  patch: { accountId?: string; actorId?: string } = {}
) =>
  ({
    type: 'queue-progress',
    accountId: patch.accountId ?? 'account-1',
    actorId: patch.actorId ?? 'actor-1',
    progress: { ...IDLE, ...progress }
  }) as const

describe('DraftsProvider send queue', () => {
  beforeAll(async () => {
    // Load the dynamic imports once, with real timers.
    await import('@/lib/client/drafts')
    await import('@/lib/client/statuses')
    await import('@/lib/client/media')
    await import('@/lib/client/fitnessImports')
    await import('@/lib/client/fitnessRoutes')
    await import('@/lib/client/gallery')
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    installFakeBroadcastChannel()
    connection.state = 'online'
    connection.restore = null
    route.pathname = '/drafts'
    vi.mocked(runPendingPurges).mockResolvedValue(undefined)
    vi.mocked(getAccountEpoch).mockResolvedValue(3)
    vi.mocked(listDrafts).mockResolvedValue([])
    vi.mocked(resumeQueue).mockResolvedValue(0)
    vi.mocked(pauseQueue).mockResolvedValue(0)
    vi.mocked(drainQueue).mockResolvedValue(ZERO)
    vi.mocked(withSenderLock).mockImplementation((fn) => fn())
  })

  afterEach(() => {
    resetDraftsChannelForTesting()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('drains on mount once the epoch resolves, after lifting only the auth and actor pauses', async () => {
    const epoch = createDeferred<number>()
    vi.mocked(getAccountEpoch).mockReturnValue(epoch.promise)
    renderProvider()
    await settle()

    expect(drainQueue).not.toHaveBeenCalled()
    expect(resumeQueue).not.toHaveBeenCalled()

    epoch.resolve(3)
    await settle()

    expect(resumeQueue).toHaveBeenCalledTimes(1)
    expect(resumeQueue).toHaveBeenCalledWith({
      actorId: 'actor-1',
      pausedBy: ['auth', 'actor']
    })
    expect(drainQueue).toHaveBeenCalledTimes(1)
    expect(drainQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        actorId: 'actor-1',
        epoch: 3,
        tabId: expect.any(String),
        signal: expect.any(AbortSignal)
      })
    )
    // Resume first: the drain would skip the paused items otherwise.
    expect(vi.mocked(resumeQueue).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(drainQueue).mock.invocationCallOrder[0]
    )
  })

  it('drains again on restore, on becoming visible and on requestDrain, but resumes only on mount', async () => {
    renderProvider()
    await settle()
    expect(drainQueue).toHaveBeenCalledTimes(1)

    act(() => connection.restore?.())
    await settle()
    expect(drainQueue).toHaveBeenCalledTimes(2)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(drainQueue).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByText('drain'))
    await settle()
    expect(drainQueue).toHaveBeenCalledTimes(4)
    expect(resumeQueue).toHaveBeenCalledTimes(1)
  })

  it('never drains while offline or unreachable', async () => {
    connection.state = 'offline'
    renderProvider()
    await settle()
    fireEvent.click(screen.getByText('drain'))
    connection.state = 'unreachable'
    fireEvent.click(screen.getByText('drain'))
    await settle()

    expect(drainQueue).not.toHaveBeenCalled()

    connection.state = 'online'
    act(() => connection.restore?.())
    await settle()
    expect(drainQueue).toHaveBeenCalledTimes(1)
  })

  it('never drains while another tab signs the account out, and resumes on cancel', async () => {
    renderProvider()
    await settle()
    drainQueueCalls(1)

    await post({ type: 'signing-out', accountId: 'account-1' })
    fireEvent.click(screen.getByText('drain'))
    await settle()
    drainQueueCalls(1)

    await post({ type: 'sign-out-cancelled', accountId: 'account-1' })
    await settle()
    drainQueueCalls(2)
  })

  it('runs one drain at a time, and every trigger during it adds one more pass', async () => {
    const first = createDeferred<typeof ZERO>()
    vi.mocked(drainQueue).mockReturnValueOnce(first.promise)
    renderProvider()
    await settle()
    drainQueueCalls(1)

    fireEvent.click(screen.getByText('drain'))
    fireEvent.click(screen.getByText('drain'))
    act(() => connection.restore?.())
    await settle()
    // Still the first drain.
    drainQueueCalls(1)

    first.resolve(ZERO)
    await settle()
    // One rerun, not three.
    drainQueueCalls(2)
    await advance(1_000)
    drainQueueCalls(2)
  })

  it('aborts the drain on signing-out', async () => {
    const pending = createDeferred<typeof ZERO>()
    vi.mocked(drainQueue).mockReturnValueOnce(pending.promise)
    renderProvider()
    await settle()
    const { signal } = vi.mocked(drainQueue).mock.calls[0][0]
    expect(signal.aborted).toBe(false)

    await post({ type: 'signing-out', accountId: 'another-account' })
    expect(signal.aborted).toBe(false)

    await post({ type: 'signing-out', accountId: 'account-1' })
    expect(signal.aborted).toBe(true)
  })

  describe('wake timer', () => {
    it('fires at the earliest nextAttemptAt among this actor’s items, one millisecond apart', async () => {
      vi.mocked(listDrafts).mockResolvedValue([
        queued('late', {
          state: 'checking',
          queuedAt: NOW - 1_000,
          attempts: 1,
          nextAttemptAt: NOW + 9_000
        }),
        queued('soon', {
          state: 'waiting',
          queuedAt: NOW - 1_000,
          attempts: 1,
          nextAttemptAt: NOW + 5_000
        })
      ])
      renderProvider()
      await settle()
      drainQueueCalls(1)

      await advance(4_999)
      drainQueueCalls(1)
      await advance(1)
      drainQueueCalls(2)
    })

    it('fires at claim.until for a lease a closed tab left behind', async () => {
      vi.mocked(listDrafts).mockResolvedValue([
        queued('stuck', {
          state: 'sending',
          queuedAt: NOW - 1_000,
          attempts: 1,
          firstAttemptAt: NOW - 500,
          claim: { tabId: 'closed-tab', until: NOW + 90_000 }
        })
      ])
      renderProvider()
      await settle()
      drainQueueCalls(1)

      await advance(89_999)
      drainQueueCalls(1)
      await advance(1)
      drainQueueCalls(2)
    })

    it('waits for the user on needs-review, couldn’t-send and user-paused items', async () => {
      vi.mocked(listDrafts).mockResolvedValue([
        queued('review', {
          state: 'needs_review',
          queuedAt: NOW,
          attempts: 0,
          nextAttemptAt: NOW + 1_000
        }),
        queued('paused', {
          state: 'paused',
          pausedBy: 'user',
          queuedAt: NOW,
          attempts: 0,
          nextAttemptAt: NOW + 1_000
        })
      ])
      renderProvider()
      await settle()
      await advance(60_000)

      drainQueueCalls(1)
    })

    it('wakes a rate-limit pause when it is due', async () => {
      vi.mocked(listDrafts).mockResolvedValue([
        queued('limited', {
          state: 'paused',
          pausedBy: 'rate_limit',
          queuedAt: NOW,
          attempts: 1,
          nextAttemptAt: NOW + 60_000
        })
      ])
      renderProvider()
      await settle()

      await advance(60_000)
      drainQueueCalls(2)
    })

    it('is recomputed on a changed message, and cleared on unmount', async () => {
      const { unmount } = renderProvider()
      await settle()
      drainQueueCalls(1)

      vi.mocked(listDrafts).mockResolvedValue([
        queued('retry', {
          state: 'waiting',
          queuedAt: NOW,
          attempts: 1,
          nextAttemptAt: NOW + 5_000
        })
      ])
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'retry'
      })
      await settle()
      await advance(5_000)
      drainQueueCalls(2)

      // A new item is scheduled, then the provider goes away.
      vi.mocked(listDrafts).mockResolvedValue([
        queued('retry', {
          state: 'waiting',
          queuedAt: NOW,
          attempts: 2,
          nextAttemptAt: NOW + 20_000
        })
      ])
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'retry'
      })
      await settle()
      unmount()
      await advance(60_000)
      drainQueueCalls(2)
    })

    it('ignores another actor’s changes', async () => {
      renderProvider()
      await settle()
      vi.mocked(listDrafts).mockClear()

      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-2',
        draftId: 'x'
      })
      await settle()

      expect(listDrafts).not.toHaveBeenCalled()
    })
  })

  describe('progress', () => {
    it('shows the sender’s own progress through the local echo', async () => {
      const pending = createDeferred<typeof ZERO>()
      vi.mocked(drainQueue).mockImplementationOnce(({ onProgress }) => {
        onProgress({ ...IDLE, phase: 'sending', index: 2, total: 5 })
        return pending.promise
      })
      renderProvider()
      await settle()

      expect(screen.getByTestId('status')).toHaveTextContent('sending 2/5')

      // A drain that returns without a result of its own leaves nothing behind.
      pending.resolve(ZERO)
      await settle()
      expect(screen.getByTestId('status')).toHaveTextContent('idle 0/0')
    })

    it('updates a second provider from a queue-progress broadcast, for its own account and actor only', async () => {
      render(
        <>
          <DraftsProvider accountId="account-1" actorId="actor-1">
            <Probe />
          </DraftsProvider>
          <DraftsProvider accountId="account-1" actorId="actor-1">
            <div data-testid="second">
              <Probe />
            </div>
          </DraftsProvider>
        </>
      )
      await settle()

      await post(
        progressMessage(
          { phase: 'sending', index: 1, total: 3 },
          { actorId: 'actor-2' }
        )
      )
      await post(
        progressMessage(
          { phase: 'sending', index: 1, total: 3 },
          { accountId: 'another-account' }
        )
      )
      for (const node of screen.getAllByTestId('status')) {
        expect(node).toHaveTextContent('idle')
      }

      await post(progressMessage({ phase: 'sending', index: 1, total: 3 }))
      for (const node of screen.getAllByTestId('status')) {
        expect(node).toHaveTextContent('sending 1/3')
      }
    })

    it('goes back to idle when a drain that was sending is aborted or fails', async () => {
      vi.mocked(drainQueue).mockImplementationOnce(async ({ onProgress }) => {
        onProgress({ ...IDLE, phase: 'sending', index: 1, total: 2 })
        throw new Error('aborted')
      })
      renderProvider()
      await settle()

      expect(screen.getByTestId('status')).toHaveTextContent('idle 0/0')
    })

    it('reverts a result at RESULT_VISIBLE_MS, one millisecond apart', async () => {
      renderProvider()
      await settle()

      await post(progressMessage({ phase: 'result', sent: 2 }))
      expect(screen.getByTestId('status')).toHaveTextContent(
        'result 0/0 sent=2'
      )

      await advance(RESULT_VISIBLE_MS - 1)
      expect(screen.getByTestId('status')).toHaveTextContent('result')
      await advance(1)
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    })

    it('reverts a result on a pathname change, and leaves a sending phase alone', async () => {
      const { rerender } = renderProvider()
      await settle()
      await post(progressMessage({ phase: 'sending', index: 1, total: 2 }))

      route.pathname = '/notifications'
      rerender(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Probe />
        </DraftsProvider>
      )
      await settle()
      expect(screen.getByTestId('status')).toHaveTextContent('sending 1/2')

      await post(progressMessage({ phase: 'result', sent: 1 }))
      expect(screen.getByTestId('status')).toHaveTextContent('result')

      route.pathname = '/'
      rerender(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Probe />
        </DraftsProvider>
      )
      await settle()
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    })
  })

  it('pause() pauses this actor’s queue and tells the other views', async () => {
    renderProvider()
    await settle()
    const changed = vi.fn()
    const { subscribeDraftsMessages } =
      await import('@/lib/client/drafts/draftsChannel')
    const stop = subscribeDraftsMessages(changed)

    await act(async () => {
      fireEvent.click(screen.getByText('pause'))
    })
    await settle()

    expect(pauseQueue).toHaveBeenCalledWith({ actorId: 'actor-1' })
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changed', actorId: 'actor-1' })
    )
    stop()
  })
})

const drainQueueCalls = (count: number) =>
  expect(drainQueue).toHaveBeenCalledTimes(count)

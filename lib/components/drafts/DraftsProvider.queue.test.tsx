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
  getDraft,
  listDrafts,
  pauseQueue,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resumeQueue,
  runPendingPurges,
  subscribeDraftsMessages,
  withSenderLock
} from '@/lib/client/drafts'
import { CLAIM_LEASE_MS } from '@/lib/client/drafts/sendQueue'
import { createDeferred } from '@/lib/testing/deferred'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import {
  DraftsProvider,
  RESULT_VISIBLE_MS,
  RETRY_SOON_MS,
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
  getDraft: vi.fn(),
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

/** Claimable now, so due at once. */
const DUE = queued('due', { state: 'waiting', queuedAt: NOW, attempts: 0 })

const Probe = () => {
  const drafts = useDrafts()
  const status = useSendQueueStatus()
  return (
    <div>
      <p data-testid="status">
        {status
          ? `${status.phase} ${status.index}/${status.total} sent=${status.sent} drainFailed=${status.drainFailed} pauseFailed=${status.pauseFailed}`
          : 'none'}
      </p>
      <button onClick={() => drafts?.requestDrain()}>drain</button>
      <button onClick={() => void status?.pause()}>pause</button>
      <button onClick={() => status?.retry()}>retry</button>
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
    vi.mocked(listDrafts).mockResolvedValue([DUE])
    vi.mocked(getDraft).mockResolvedValue(DUE)
    vi.mocked(resumeQueue).mockResolvedValue(0)
    vi.mocked(pauseQueue).mockResolvedValue(0)
    vi.mocked(drainQueue).mockResolvedValue(ZERO)
    vi.mocked(withSenderLock).mockImplementation(async (fn) => {
      await fn()
      return true
    })
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

  it('sends nothing where the page reloads itself when back online', async () => {
    render(
      <DraftsProvider accountId="account-1" actorId="actor-1" sends={false}>
        <Probe />
      </DraftsProvider>
    )
    await settle()
    act(() => connection.restore?.())
    await advance(60_000)

    expect(withSenderLock).not.toHaveBeenCalled()
    drainQueueCalls(0)
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
      // Nothing is due yet, so the mount pass skips the sender.
      drainQueueCalls(0)

      await advance(4_999)
      drainQueueCalls(0)
      await advance(1)
      drainQueueCalls(1)
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
      drainQueueCalls(0)

      await advance(89_999)
      drainQueueCalls(0)
      await advance(1)
      drainQueueCalls(1)
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

      expect(withSenderLock).not.toHaveBeenCalled()
      drainQueueCalls(0)
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
      drainQueueCalls(0)

      await advance(60_000)
      drainQueueCalls(1)
    })

    it('tries a past-due item again soon, never in a tight loop, and not while offline', async () => {
      vi.mocked(listDrafts).mockResolvedValue([
        queued('late', {
          state: 'checking',
          queuedAt: NOW - 60_000,
          attempts: 1,
          firstAttemptAt: NOW - 60_000,
          nextAttemptAt: NOW - 1
        })
      ])
      // Each pass reaches it, yet it stays due (it fell due during the pass).
      vi.mocked(drainQueue).mockResolvedValue({ ...ZERO, attempted: 1 })
      renderProvider()
      await settle()
      drainQueueCalls(1)

      await advance(RETRY_SOON_MS - 1)
      drainQueueCalls(1)
      await advance(1)
      drainQueueCalls(2)

      connection.state = 'offline'
      await advance(RETRY_SOON_MS)
      drainQueueCalls(2)
      const reads = vi.mocked(listDrafts).mock.calls.length
      await advance(60_000)
      expect(listDrafts).toHaveBeenCalledTimes(reads)
    })

    describe('never spins on a pass that cannot move the queue', () => {
      const PAST_DUE = queued('late', {
        state: 'checking',
        queuedAt: NOW - 60_000,
        attempts: 1,
        firstAttemptAt: NOW - 60_000,
        nextAttemptAt: NOW - 1
      })

      it('waits for the next trigger after a pass that claimed nothing', async () => {
        vi.mocked(listDrafts).mockResolvedValue([PAST_DUE])
        renderProvider()
        await settle()
        drainQueueCalls(1)

        await advance(60_000)
        drainQueueCalls(1)

        // The next trigger tries again.
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
        })
        await settle()
        drainQueueCalls(2)
      })

      it('waits for the next trigger after a pass that failed', async () => {
        vi.mocked(listDrafts).mockResolvedValue([PAST_DUE])
        vi.mocked(withSenderLock).mockRejectedValue(new Error('chunk'))
        renderProvider()
        await settle()
        expect(withSenderLock).toHaveBeenCalledTimes(1)

        await advance(60_000)
        expect(withSenderLock).toHaveBeenCalledTimes(1)
      })

      it.each(['auth', 'actor'] as const)(
        'holds the queue while an item is paused by %s',
        async (pausedBy) => {
          // Neither a past-due nor a fresh item posts into the same 401 or 409.
          vi.mocked(listDrafts).mockResolvedValue([
            PAST_DUE,
            DUE,
            queued('held', {
              state: 'paused',
              pausedBy,
              queuedAt: NOW,
              attempts: 1
            })
          ])
          vi.mocked(drainQueue).mockResolvedValue({ ...ZERO, attempted: 1 })
          renderProvider()
          await settle()
          // The load that lifts it is the mount's (mocked here): until then
          // no pass, timer or trigger sends anything.
          drainQueueCalls(0)
          // Nor does the wake timer poll the store meanwhile.
          const reads = vi.mocked(listDrafts).mock.calls.length
          await advance(60_000)
          expect(listDrafts).toHaveBeenCalledTimes(reads)
          await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
          })
          await settle()
          drainQueueCalls(0)
        }
      )

      it('does not let a rerun asked for during a pass post into a fresh 401', async () => {
        let store: DraftRecord[] = [DUE, PAST_DUE]
        vi.mocked(listDrafts).mockImplementation(async () => store)
        const first = createDeferred<typeof ZERO>()
        vi.mocked(drainQueue).mockImplementationOnce(async () => {
          await first.promise
          // The first item got a 401, and the drain stopped there.
          store = [
            {
              ...DUE,
              queue: { ...DUE.queue!, state: 'paused', pausedBy: 'auth' }
            },
            PAST_DUE
          ]
          return { ...ZERO, attempted: 1, paused: 1 }
        })
        renderProvider()
        await settle()
        drainQueueCalls(1)

        // A trigger while the POST is out asks for one more pass.
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
        })
        first.resolve(ZERO)
        await settle()
        await advance(60_000)
        drainQueueCalls(1)
      })

      it('ignores another account’s item with the same actor', async () => {
        vi.mocked(listDrafts).mockResolvedValue([
          { ...PAST_DUE, accountId: 'account-2' }
        ])
        renderProvider()
        await settle()
        const reads = vi.mocked(listDrafts).mock.calls.length

        await advance(60_000)
        expect(listDrafts).toHaveBeenCalledTimes(reads)
        drainQueueCalls(0)
      })

      it('sends an item another tab queued but could not send', async () => {
        let store: DraftRecord[] = []
        vi.mocked(listDrafts).mockImplementation(async () => store)
        renderProvider()
        await settle()
        drainQueueCalls(0)

        // Queued in a tab that can't reach the server, then left.
        store = [DUE]
        await post({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: DUE.id
        })
        await settle()
        await advance(RETRY_SOON_MS)
        drainQueueCalls(1)
      })

      it('keeps the time of an item that falls due while a reschedule reads', async () => {
        const later = queued('later', {
          state: 'checking',
          queuedAt: NOW,
          attempts: 1,
          firstAttemptAt: NOW,
          nextAttemptAt: NOW + 5_000
        })
        vi.mocked(listDrafts).mockResolvedValue([PAST_DUE, later])
        renderProvider()
        await settle()
        // The mount pass claimed nothing: past-due items wait from here on.
        drainQueueCalls(1)

        await advance(4_999)
        const read = createDeferred<DraftRecord[]>()
        vi.mocked(listDrafts).mockImplementationOnce(() => read.promise)
        await post({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: later.id
        })
        await advance(2)
        read.resolve([PAST_DUE, later])
        await settle()
        await advance(0)
        drainQueueCalls(2)
      })

      it('still sends an item another tab queues after a pass that claimed nothing', async () => {
        let store: DraftRecord[] = [PAST_DUE]
        vi.mocked(listDrafts).mockImplementation(async () => store)
        renderProvider()
        await settle()
        drainQueueCalls(1)

        // Only the item the pass could not move waits; a new one is sent.
        store = [PAST_DUE, DUE]
        await post({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: DUE.id
        })
        await settle()
        await advance(RETRY_SOON_MS)
        drainQueueCalls(2)
      })

      it('tries a stalled item again once it changes', async () => {
        let store: DraftRecord[] = [{ ...PAST_DUE, revision: 1 }]
        vi.mocked(listDrafts).mockImplementation(async () => store)
        renderProvider()
        await settle()
        drainQueueCalls(1)

        // Another tab wrote it (say, released a claim): a new revision.
        store = [{ ...PAST_DUE, revision: 2 }]
        await post({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: PAST_DUE.id
        })
        await settle()
        await advance(RETRY_SOON_MS)
        drainQueueCalls(2)
      })

      it('stops retrying a lock miss once the other tab sent the item', async () => {
        let store = [DUE]
        vi.mocked(listDrafts).mockImplementation(async () => store)
        vi.mocked(withSenderLock).mockResolvedValueOnce(false)
        renderProvider()
        await settle()

        // The holder sent it: the retry finds nothing due, and stops there.
        store = []
        await advance(RETRY_SOON_MS)
        const reads = vi.mocked(listDrafts).mock.calls.length
        await advance(60_000)
        expect(listDrafts).toHaveBeenCalledTimes(reads)
      })

      it('stops retrying a lock miss once a pass fails', async () => {
        vi.mocked(listDrafts).mockResolvedValue([DUE])
        vi.mocked(withSenderLock)
          .mockResolvedValueOnce(false)
          .mockRejectedValue(new Error('chunk'))
        renderProvider()
        await settle()
        expect(withSenderLock).toHaveBeenCalledTimes(1)

        await advance(RETRY_SOON_MS)
        expect(withSenderLock).toHaveBeenCalledTimes(2)
        await advance(60_000)
        expect(withSenderLock).toHaveBeenCalledTimes(2)
      })

      it('forgets a stalled pass once a later pass finds nothing due', async () => {
        let store = [PAST_DUE]
        vi.mocked(listDrafts).mockImplementation(async () => store)
        vi.mocked(withSenderLock).mockRejectedValueOnce(new Error('chunk'))
        renderProvider()
        await settle()

        store = []
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
        })
        await settle()

        // A past-due item seen later is tried soon again.
        store = [PAST_DUE]
        vi.mocked(drainQueue).mockResolvedValue({ ...ZERO, attempted: 1 })
        await post({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: PAST_DUE.id
        })
        await settle()
        drainQueueCalls(0)
        await advance(RETRY_SOON_MS)
        drainQueueCalls(1)
      })
    })

    it('tries again once another tab’s pass ends, so an item queued during it is not left waiting', async () => {
      // One lock and one store between the two providers, as between two tabs.
      let held = false
      vi.mocked(withSenderLock).mockImplementation(async (fn) => {
        if (held) return false
        held = true
        try {
          await fn()
        } finally {
          held = false
        }
        return true
      })
      const late = queued('late', {
        state: 'waiting',
        queuedAt: NOW,
        attempts: 0
      })
      let store = [DUE]
      vi.mocked(listDrafts).mockImplementation(async () => store)
      // A drain sends whatever is due when it lists the queue.
      vi.mocked(drainQueue).mockImplementation(async () => {
        const attempted = store.length
        store = []
        return { ...ZERO, attempted, sent: attempted }
      })
      const first = createDeferred<typeof ZERO>()
      vi.mocked(drainQueue).mockImplementationOnce(async () => {
        await first.promise
        store = store.filter((draft) => draft.id !== DUE.id)
        return { ...ZERO, attempted: 1, sent: 1 }
      })
      render(
        <>
          <DraftsProvider accountId="account-1" actorId="actor-1">
            <Probe />
          </DraftsProvider>
          <DraftsProvider accountId="account-1" actorId="actor-1">
            <div />
          </DraftsProvider>
        </>
      )
      await settle()
      // One holds the lock; the other was turned away.
      expect(withSenderLock).toHaveBeenCalledTimes(2)
      drainQueueCalls(1)

      // An item is queued after the holder listed the queue, and the holder
      // announces another item's outcome: neither cancels the retry.
      store = [DUE, late]
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'other'
      })
      await settle()

      // While the holder drains, the other only checks every RETRY_SOON_MS.
      await advance(RETRY_SOON_MS)
      expect(withSenderLock).toHaveBeenCalledTimes(3)
      drainQueueCalls(1)

      // The late item is sent once the holder's pass ends, by one tab.
      first.resolve(ZERO)
      await settle()
      await advance(RETRY_SOON_MS)
      expect(store).toEqual([])
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

    it('rescans on a change to a queued draft only, not on every autosave', async () => {
      renderProvider()
      await settle()
      vi.mocked(listDrafts).mockClear()

      vi.mocked(getDraft).mockResolvedValue({
        id: 'plain',
        accountId: 'account-1',
        actorId: 'actor-1'
      } as DraftRecord)
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'plain'
      })
      await settle()
      expect(getDraft).toHaveBeenCalledWith('plain')
      expect(listDrafts).not.toHaveBeenCalled()

      vi.mocked(getDraft).mockResolvedValue(DUE)
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'due'
      })
      await settle()
      expect(listDrafts).toHaveBeenCalledTimes(1)
    })

    it('reschedules on a bulk change with no draft id, without looking one up', async () => {
      renderProvider()
      await settle()
      drainQueueCalls(1)
      // A non-queued lookup would not reschedule, so only the bulk branch can.
      vi.mocked(getDraft).mockResolvedValue({
        id: 'plain',
        accountId: 'account-1',
        actorId: 'actor-1'
      } as DraftRecord)
      vi.mocked(listDrafts).mockResolvedValue([
        queued('retry', {
          state: 'waiting',
          queuedAt: NOW,
          attempts: 1,
          nextAttemptAt: NOW + 5_000
        })
      ])

      // A bulk change (pause or resume of the whole queue) names no draft.
      await post({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: ''
      })
      await settle()
      await advance(5_000)

      expect(getDraft).not.toHaveBeenCalled()
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

    it('posts nothing on the channel for a drain that claimed nothing', async () => {
      const seen: string[] = []
      const unsubscribe = subscribeDraftsMessages((message) =>
        seen.push(message.type)
      )
      vi.mocked(drainQueue).mockImplementation(async ({ onProgress }) => {
        onProgress(IDLE)
        return ZERO
      })
      renderProvider()
      await settle()
      expect(drainQueue).toHaveBeenCalled()
      expect(seen).not.toContain('queue-progress')

      // A drain that sent still says so, and closes with its result.
      vi.mocked(drainQueue).mockImplementationOnce(async ({ onProgress }) => {
        onProgress({ ...IDLE, phase: 'sending', index: 1, total: 1 })
        onProgress({ ...IDLE, phase: 'result', sent: 1 })
        return ZERO
      })
      await act(async () => screen.getByText('drain').click())
      await settle()
      expect(seen.filter((type) => type === 'queue-progress')).toHaveLength(2)
      unsubscribe()
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

    it('expires a received "sending" at CLAIM_LEASE_MS, one millisecond apart, and drains', async () => {
      renderProvider()
      await settle()
      vi.mocked(drainQueue).mockClear()
      // Another tab claimed the item, then went quiet.
      vi.mocked(listDrafts).mockResolvedValue([
        {
          ...DUE,
          queue: {
            ...DUE.queue!,
            state: 'sending',
            claim: { tabId: 'other', until: NOW + CLAIM_LEASE_MS }
          }
        }
      ])

      await post(progressMessage({ phase: 'sending', index: 1, total: 2 }))
      await advance(CLAIM_LEASE_MS - 1)
      expect(screen.getByTestId('status')).toHaveTextContent('sending 1/2')
      expect(drainQueue).not.toHaveBeenCalled()

      await advance(1)
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
      expect(drainQueue).toHaveBeenCalledTimes(1)
    })

    it('restarts the expiry on every progress update', async () => {
      renderProvider()
      await settle()
      vi.mocked(drainQueue).mockClear()
      // Another tab is sending, and renews its lease as it goes.
      vi.mocked(listDrafts).mockResolvedValue([
        {
          ...DUE,
          queue: {
            ...DUE.queue!,
            state: 'sending',
            claim: { tabId: 'other', until: NOW + 3 * CLAIM_LEASE_MS }
          }
        }
      ])

      await post(progressMessage({ phase: 'sending', index: 1, total: 2 }))
      await advance(CLAIM_LEASE_MS - 1)
      await post(progressMessage({ phase: 'sending', index: 2, total: 2 }))
      await advance(CLAIM_LEASE_MS - 1)
      expect(screen.getByTestId('status')).toHaveTextContent('sending 2/2')
      expect(drainQueue).not.toHaveBeenCalled()
      await advance(1)
      expect(screen.getByTestId('status')).toHaveTextContent('idle')
    })

    it('keeps its own progress while its own drain is still running', async () => {
      const pending = createDeferred<typeof ZERO>()
      vi.mocked(drainQueue).mockImplementationOnce(({ onProgress }) => {
        onProgress({ ...IDLE, phase: 'sending', index: 1, total: 1 })
        return pending.promise
      })
      renderProvider()
      await settle()

      await advance(CLAIM_LEASE_MS + 1)
      expect(screen.getByTestId('status')).toHaveTextContent('sending 1/1')
      expect(drainQueue).toHaveBeenCalledTimes(1)
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

  it('skips the sender, its code and the lock when nothing is due', async () => {
    vi.mocked(listDrafts).mockResolvedValue([])
    renderProvider()
    await settle()

    expect(listDrafts).toHaveBeenCalled()
    expect(withSenderLock).not.toHaveBeenCalled()
    drainQueueCalls(0)
  })

  it('records a failed drain for the Drafts page, and clears it on a good retry', async () => {
    vi.mocked(drainQueue).mockRejectedValueOnce(new Error('storage'))
    renderProvider()
    await settle()
    expect(screen.getByTestId('status')).toHaveTextContent('drainFailed=true')

    fireEvent.click(screen.getByText('retry'))
    await settle()
    drainQueueCalls(2)
    expect(screen.getByTestId('status')).toHaveTextContent('drainFailed=false')
  })

  it('records a failed Pause while sending, and forgets it once sending ends', async () => {
    vi.mocked(pauseQueue).mockRejectedValue(new Error('no db'))
    renderProvider()
    await settle()
    await post(progressMessage({ phase: 'sending', index: 1, total: 2 }))

    await act(async () => {
      fireEvent.click(screen.getByText('pause'))
    })
    await settle()
    expect(screen.getByTestId('status')).toHaveTextContent('pauseFailed=true')

    await post(progressMessage({ phase: 'result', sent: 2 }))
    expect(screen.getByTestId('status')).toHaveTextContent('pauseFailed=false')
  })

  it('clears a failed Pause when the next one succeeds', async () => {
    vi.mocked(pauseQueue).mockRejectedValueOnce(new Error('no db'))
    renderProvider()
    await settle()
    await post(progressMessage({ phase: 'sending', index: 1, total: 2 }))

    await act(async () => {
      fireEvent.click(screen.getByText('pause'))
    })
    await settle()
    expect(screen.getByTestId('status')).toHaveTextContent('pauseFailed=true')

    await act(async () => {
      fireEvent.click(screen.getByText('pause'))
    })
    await settle()
    expect(screen.getByTestId('status')).toHaveTextContent('pauseFailed=false')
    expect(screen.getByTestId('status')).toHaveTextContent('sending')
  })

  it('does not drain for another account’s due draft', async () => {
    vi.mocked(listDrafts).mockResolvedValue([
      { ...DUE, accountId: 'account-2' } as DraftRecord
    ])
    renderProvider()
    await settle()

    expect(listDrafts).toHaveBeenCalled()
    drainQueueCalls(0)
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

import { SYNC_BLUESKY_HOME_JOB_NAME } from '@/lib/jobs/names'
import {
  BLUESKY_SYNC_INTERVAL_MS,
  startBlueskySyncSweep
} from '@/lib/services/bluesky/syncSweep'
import { getQueue } from '@/lib/services/queue'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

type SweepDatabase = Parameters<typeof startBlueskySyncSweep>[0]

describe('startBlueskySyncSweep', () => {
  const publish = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes one job per linked account each window, deduped by actor and window', async () => {
    vi.setSystemTime(BLUESKY_SYNC_INTERVAL_MS * 100)
    const listBlueskyAccountsToSync = vi
      .fn()
      .mockResolvedValue(['actor-a', 'actor-b'])
    const sweep = startBlueskySyncSweep({
      listBlueskyAccountsToSync
    } as unknown as SweepDatabase)
    expect(listBlueskyAccountsToSync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS)
    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      {
        id: 'bluesky-home:actor-a:101',
        name: SYNC_BLUESKY_HOME_JOB_NAME,
        data: { actorId: 'actor-a' }
      },
      {
        id: 'bluesky-home:actor-b:101',
        name: SYNC_BLUESKY_HOME_JOB_NAME,
        data: { actorId: 'actor-b' }
      }
    ])

    sweep.stop()
    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS * 3)
    expect(listBlueskyAccountsToSync).toHaveBeenCalledTimes(1)
  })

  it('keeps publishing for the other accounts when one publish fails', async () => {
    publish.mockRejectedValueOnce(new Error('queue down'))
    const sweep = startBlueskySyncSweep({
      listBlueskyAccountsToSync: vi.fn().mockResolvedValue(['a', 'b'])
    } as unknown as SweepDatabase)

    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS)
    expect(publish).toHaveBeenCalledTimes(2)
    sweep.stop()
  })

  it('never starts a tick while the last one is still running', async () => {
    let finish = () => {}
    const listBlueskyAccountsToSync = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = () => resolve([])
        })
    )
    const sweep = startBlueskySyncSweep({
      listBlueskyAccountsToSync
    } as unknown as SweepDatabase)

    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS)
    // A slow tick spans several intervals without a second one starting.
    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS * 3)
    expect(listBlueskyAccountsToSync).toHaveBeenCalledTimes(1)

    finish()
    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS)
    expect(listBlueskyAccountsToSync).toHaveBeenCalledTimes(2)
    sweep.stop()
  })

  it('tries again on the next tick after a failed one', async () => {
    const listBlueskyAccountsToSync = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue([])
    const sweep = startBlueskySyncSweep({
      listBlueskyAccountsToSync
    } as unknown as SweepDatabase)

    await vi.advanceTimersByTimeAsync(BLUESKY_SYNC_INTERVAL_MS * 2)
    expect(listBlueskyAccountsToSync).toHaveBeenCalledTimes(2)
    sweep.stop()
  })
})

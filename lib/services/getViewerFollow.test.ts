import { Database } from '@/lib/database/types'
import { runInReactCacheScope } from '@/lib/testing/reactCacheScope'
import { FollowStatus } from '@/lib/types/domain/follow'

import { getViewerFollow } from './getViewerFollow'

// See app/(timeline)/[actor]/profileFollowLookup.test.ts for why the server
// build's `cache` has to be swapped in.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const { serverCache } = await import('@/lib/testing/reactCacheScope')
  return { ...actual, cache: serverCache }
})

describe('getViewerFollow', () => {
  const VIEWER = 'https://example.com/users/viewer'
  const OTHER_VIEWER = 'https://example.com/users/other'
  const TARGET = 'https://example.com/users/target'
  const OTHER_TARGET = 'https://example.com/users/second-target'

  const getAcceptedOrRequestedFollow = vi.fn()
  const database = { getAcceptedOrRequestedFollow } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    getAcceptedOrRequestedFollow.mockImplementation(
      async ({
        actorId,
        targetActorId
      }: {
        actorId: string
        targetActorId: string
      }) => ({
        id: `${actorId}->${targetActorId}`,
        status: FollowStatus.enum.Accepted
      })
    )
  })

  it('reads a row once per request and returns it to every caller', async () => {
    const [first, second] = await runInReactCacheScope(async () =>
      Promise.all([
        getViewerFollow(database, VIEWER, TARGET),
        getViewerFollow(database, VIEWER, TARGET)
      ])
    )

    expect(getAcceptedOrRequestedFollow).toHaveBeenCalledTimes(1)
    expect(getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: VIEWER,
      targetActorId: TARGET
    })
    expect(first).toBe(second)
  })

  // The keys must separate both operands. A cache that collapsed them would
  // answer "does this viewer follow that actor?" with somebody else's row,
  // which is what decides whether followers-only posts are shown.
  it.each([
    {
      description: 'gives a different viewer its own row',
      viewerId: OTHER_VIEWER,
      targetActorId: TARGET
    },
    {
      description: 'gives a different target its own row',
      viewerId: VIEWER,
      targetActorId: OTHER_TARGET
    }
  ])('$description', async ({ viewerId, targetActorId }) => {
    const row = await runInReactCacheScope(async () => {
      await getViewerFollow(database, VIEWER, TARGET)
      return getViewerFollow(database, viewerId, targetActorId)
    })

    expect(getAcceptedOrRequestedFollow).toHaveBeenCalledTimes(2)
    expect(row).toMatchObject({ id: `${viewerId}->${targetActorId}` })
  })
})

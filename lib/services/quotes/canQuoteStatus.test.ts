import type { Database } from '@/lib/database/types'
import { canQuoteStatus } from '@/lib/services/quotes/canQuoteStatus'
import { FollowStatus } from '@/lib/types/domain/follow'
import type { Status } from '@/lib/types/domain/status'

const AUTHOR = 'https://llun.test/users/author'
const QUOTER = 'https://remote.example/users/quoter'

const makeQuoted = (
  policy?: 'public' | 'followers' | 'nobody',
  actorId = AUTHOR
): Status =>
  ({
    type: 'Note',
    actorId,
    ...(policy ? { quoteApprovalPolicy: policy } : {})
  }) as unknown as Status

const makeDatabase = (
  overrides: Partial<{
    eitherBlocking: boolean
    follow: FollowStatus | null
  }> = {}
): Database =>
  ({
    isEitherBlocking: async () => overrides.eitherBlocking ?? false,
    getAcceptedOrRequestedFollow: async () =>
      overrides.follow ? { status: overrides.follow } : null
  }) as unknown as Database

describe('canQuoteStatus', () => {
  it('allows a self-quote regardless of policy', async () => {
    const verdict = await canQuoteStatus({
      database: makeDatabase(),
      quotedStatus: makeQuoted('nobody', QUOTER),
      quotingActorId: QUOTER
    })
    expect(verdict).toBe('automatic')
  })

  it('denies when either party blocks the other', async () => {
    const verdict = await canQuoteStatus({
      database: makeDatabase({ eitherBlocking: true }),
      quotedStatus: makeQuoted('public'),
      quotingActorId: QUOTER
    })
    expect(verdict).toBe('denied')
  })

  it.each([
    {
      description: 'public policy',
      policy: 'public' as const,
      expected: 'automatic'
    },
    {
      description: 'nobody policy',
      policy: 'nobody' as const,
      expected: 'denied'
    },
    {
      description: 'default (absent) policy is public',
      policy: undefined,
      expected: 'automatic'
    }
  ])('returns $expected for $description', async ({ policy, expected }) => {
    const verdict = await canQuoteStatus({
      database: makeDatabase(),
      quotedStatus: makeQuoted(policy),
      quotingActorId: QUOTER
    })
    expect(verdict).toBe(expected)
  })

  it('allows a follower under the followers policy', async () => {
    const verdict = await canQuoteStatus({
      database: makeDatabase({ follow: FollowStatus.enum.Accepted }),
      quotedStatus: makeQuoted('followers'),
      quotingActorId: QUOTER
    })
    expect(verdict).toBe('automatic')
  })

  it.each([
    { description: 'a non-follower', follow: null },
    {
      description: 'a merely-requested follow',
      follow: FollowStatus.enum.Requested
    }
  ])('denies $description under the followers policy', async ({ follow }) => {
    const verdict = await canQuoteStatus({
      database: makeDatabase({ follow }),
      quotedStatus: makeQuoted('followers'),
      quotingActorId: QUOTER
    })
    expect(verdict).toBe('denied')
  })
})

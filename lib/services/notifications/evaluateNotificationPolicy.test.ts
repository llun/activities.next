import { Database } from '@/lib/database/types'
import { evaluateNotificationPolicy } from '@/lib/services/notifications/evaluateNotificationPolicy'
import {
  DEFAULT_NOTIFICATION_POLICY,
  NotificationPolicy
} from '@/lib/types/database/operations'

const RECIPIENT = 'https://llun.test/users/me'
const SOURCE = 'https://other.test/users/stranger'
const NOW = 1_700_000_000_000

type MockDb = {
  getNotificationPolicy: jest.Mock
  getActorSettings: jest.Mock
  isCurrentActorFollowing: jest.Mock
  getActorFromId: jest.Mock
  getStatus: jest.Mock
}

const createDatabase = (
  policy: Partial<NotificationPolicy>,
  overrides: Partial<MockDb> = {}
): { database: Database; mock: MockDb } => {
  const mock: MockDb = {
    getNotificationPolicy: jest
      .fn()
      .mockResolvedValue({ ...DEFAULT_NOTIFICATION_POLICY, ...policy }),
    // Default: no accepted senders list.
    getActorSettings: jest.fn().mockResolvedValue(undefined),
    // Default: neither side follows the other.
    isCurrentActorFollowing: jest.fn().mockResolvedValue(false),
    getActorFromId: jest.fn().mockResolvedValue({ createdAt: 0 }),
    getStatus: jest.fn().mockResolvedValue(null),
    ...overrides
  }
  return { database: mock as unknown as Database, mock }
}

describe('#evaluateNotificationPolicy', () => {
  it('accepts notifications from yourself without consulting the policy', async () => {
    const { database, mock } = createDatabase({ for_not_following: 'drop' })
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: RECIPIENT,
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
    expect(mock.getNotificationPolicy).not.toHaveBeenCalled()
  })

  it('short-circuits to accept when every dimension is accept', async () => {
    const { database, mock } = createDatabase({})
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
    expect(mock.isCurrentActorFollowing).not.toHaveBeenCalled()
  })

  it('filters when recipient does not follow a for_not_following=filter source', async () => {
    const { database } = createDatabase({ for_not_following: 'filter' })
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('filter')
  })

  it('accepts when recipient already follows the source', async () => {
    const { database } = createDatabase(
      { for_not_following: 'drop' },
      {
        isCurrentActorFollowing: jest
          .fn()
          .mockImplementation(({ currentActorId }) =>
            Promise.resolve(currentActorId === RECIPIENT)
          )
      }
    )
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
  })

  it('returns the most restrictive verdict across matching dimensions', async () => {
    const { database } = createDatabase({
      for_not_following: 'filter',
      for_not_followers: 'drop'
    })
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('drop')
  })

  it('filters new accounts younger than 30 days', async () => {
    const tenDaysAgo = NOW - 10 * 24 * 60 * 60 * 1000
    const { database } = createDatabase(
      { for_new_accounts: 'filter' },
      { getActorFromId: jest.fn().mockResolvedValue({ createdAt: tenDaysAgo }) }
    )
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'follow',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('filter')
  })

  it('accepts accounts older than 30 days under for_new_accounts', async () => {
    const longAgo = NOW - 90 * 24 * 60 * 60 * 1000
    const { database } = createDatabase(
      { for_new_accounts: 'filter' },
      { getActorFromId: jest.fn().mockResolvedValue({ createdAt: longAgo }) }
    )
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'follow',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
  })

  it('filters direct mentions under for_private_mentions', async () => {
    const { database } = createDatabase(
      { for_private_mentions: 'filter' },
      {
        getStatus: jest.fn().mockResolvedValue({ to: [RECIPIENT], cc: [] })
      }
    )
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'mention',
      sourceActorId: SOURCE,
      statusId: 'https://other.test/statuses/1',
      currentTime: NOW
    })
    expect(verdict).toBe('filter')
  })

  it('does not apply for_private_mentions to public mentions', async () => {
    const { database } = createDatabase(
      { for_private_mentions: 'drop' },
      {
        getStatus: jest.fn().mockResolvedValue({
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: []
        })
      }
    )
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'mention',
      sourceActorId: SOURCE,
      statusId: 'https://other.test/statuses/1',
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
  })

  it('never enforces for_limited_accounts (no-op)', async () => {
    const { database } = createDatabase({ for_limited_accounts: 'drop' })
    const verdict = await evaluateNotificationPolicy(database, {
      actorId: RECIPIENT,
      type: 'like',
      sourceActorId: SOURCE,
      currentTime: NOW
    })
    expect(verdict).toBe('accept')
  })
})

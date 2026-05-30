import { Database } from '@/lib/database/types'
import { getNotificationGroupsEnvelope } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

const mockGetMastodonStatus = jest.fn()
jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...args: unknown[]) => mockGetMastodonStatus(...args)
}))

const ALICE = 'https://other.test/users/alice'
const BOB = 'https://other.test/users/bob'
const STATUS = 'https://other.test/statuses/1'

const grouped = (
  overrides: Partial<GroupedNotification>
): GroupedNotification => ({
  id: 'n',
  actorId: 'https://llun.test/users/me',
  type: 'like',
  sourceActorId: ALICE,
  isRead: false,
  filtered: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('#getNotificationGroupsEnvelope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('dedupes accounts and statuses referenced across groups', async () => {
    const mockDatabase = {
      // Return id in urlToId format so sample_account_ids filtering works.
      getMastodonActorsFromIds: jest
        .fn()
        .mockImplementation(({ ids }: { ids: string[] }) =>
          Promise.resolve(
            ids.map((id) => ({
              id: id.replace(/https?:\/\//, '').replaceAll('/', ':')
            }))
          )
        ),
      getStatus: jest.fn().mockResolvedValue({ id: STATUS }),
      getStatusesByIds: jest
        .fn()
        .mockImplementation(({ statusIds }: { statusIds: string[] }) =>
          Promise.resolve(statusIds.map((id) => ({ id })))
        )
    } as unknown as Database
    // Return id in urlToId format so the hide-filter check in resolveStatuses
    // can match it against the group's status_id field.
    // urlToId('https://other.test/statuses/1') = 'other.test:statuses:1'
    mockGetMastodonStatus.mockResolvedValue({ id: 'other.test:statuses:1' })

    // Two like groups on the same status from alice and bob (status referenced
    // twice), plus a follow group from alice (alice referenced again).
    const groups: GroupedNotification[] = [
      grouped({
        id: 'g1',
        groupKey: `like:${STATUS}`,
        statusId: STATUS,
        groupedActors: [ALICE, BOB],
        groupedCount: 2
      }),
      grouped({
        id: 'g2',
        type: 'reblog',
        groupKey: `reblog:${STATUS}`,
        statusId: STATUS,
        groupedActors: [ALICE],
        groupedCount: 1
      }),
      grouped({
        id: 'g3',
        type: 'follow',
        sourceActorId: ALICE,
        groupKey: undefined,
        groupedCount: 1
      })
    ]

    const envelope = await getNotificationGroupsEnvelope(
      mockDatabase,
      groups,
      'https://llun.test/users/me'
    )

    expect(envelope.notification_groups).toHaveLength(3)

    // alice + bob, deduped despite three references.
    const accountIds = (mockDatabase.getMastodonActorsFromIds as jest.Mock).mock
      .calls[0][0].ids
    expect([...accountIds].sort()).toEqual([ALICE, BOB].sort())

    // The status is fetched once via batch despite two groups referencing it.
    expect(mockDatabase.getStatusesByIds).toHaveBeenCalledTimes(1)
    expect(
      (mockDatabase.getStatusesByIds as jest.Mock).mock.calls[0][0].statusIds
    ).toHaveLength(1)
    expect(envelope.statuses).toHaveLength(1)
  })

  it('returns empty accounts/statuses when there is nothing to resolve', async () => {
    const mockDatabase = {
      getMastodonActorsFromIds: jest.fn().mockResolvedValue([]),
      getStatusesByIds: jest.fn()
    } as unknown as Database

    const envelope = await getNotificationGroupsEnvelope(mockDatabase, [])

    expect(envelope).toEqual({
      notification_groups: [],
      accounts: [],
      statuses: []
    })
    expect(mockDatabase.getMastodonActorsFromIds).not.toHaveBeenCalled()
    expect(mockDatabase.getStatusesByIds).not.toHaveBeenCalled()
  })
})

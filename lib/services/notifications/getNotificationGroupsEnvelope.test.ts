import { Database } from '@/lib/database/types'
import { getNotificationGroupsEnvelope } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

const mockGetMastodonStatuses = vi.fn()
vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: (...args: unknown[]) => mockGetMastodonStatuses(...args)
}))

// The serialized status carries the domain row's ActivityPub id as `uri`, which
// is what the envelope pairs the two on; `id` is the flipped client-facing id.
const mockSerializedStatusesWithId = (id: string) =>
  mockGetMastodonStatuses.mockImplementation(
    (_database: unknown, statuses: { id: string }[]) =>
      Promise.resolve(statuses.map((status) => ({ id, uri: status.id })))
  )

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

describe('getNotificationGroupsEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dedupes accounts and statuses referenced across groups', async () => {
    const mockDatabase = {
      // Return id in urlToId format so sample_account_ids filtering works.
      getMastodonActorsFromIds: vi
        .fn()
        .mockImplementation(({ ids }: { ids: string[] }) =>
          Promise.resolve(
            ids.map((id) => ({
              id: id.replace(/https?:\/\//, '').replaceAll('/', ':')
            }))
          )
        ),
      getStatus: vi.fn().mockResolvedValue({ id: STATUS }),
      getStatusesByIds: vi
        .fn()
        .mockImplementation(({ statusIds }: { statusIds: string[] }) =>
          Promise.resolve(statusIds.map((id) => ({ id })))
        ),
      // No publicIds: pre-backfill rows keep the legacy encoding on both the
      // group ids and the account/status entities, so the join still holds.
      getActorPublicIds: vi.fn().mockResolvedValue(new Map<string, string>()),
      getStatusPublicIds: vi.fn().mockResolvedValue(new Map<string, string>())
    } as unknown as Database
    // Return id in urlToId format so the hide-filter check in resolveStatuses
    // can match it against the group's status_id field.
    // urlToId('https://other.test/statuses/1') = 'other.test:statuses:1'
    mockSerializedStatusesWithId('other.test:statuses:1')

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

  it('rewrites group ids to publicIds that join against the envelope arrays', async () => {
    const ALICE_PUBLIC_ID = '019a0000-0000-7000-8000-00000000000a'
    const STATUS_PUBLIC_ID = '019a0000-0000-7000-8000-00000000000b'
    const mockDatabase = {
      getMastodonActorsFromIds: vi
        .fn()
        .mockResolvedValue([{ id: ALICE_PUBLIC_ID }]),
      getStatusesByIds: vi
        .fn()
        .mockImplementation(({ statusIds }: { statusIds: string[] }) =>
          Promise.resolve(statusIds.map((id) => ({ id })))
        ),
      getActorPublicIds: vi
        .fn()
        .mockResolvedValue(new Map([[ALICE, ALICE_PUBLIC_ID]])),
      getStatusPublicIds: vi
        .fn()
        .mockResolvedValue(new Map([[STATUS, STATUS_PUBLIC_ID]]))
    } as unknown as Database
    mockSerializedStatusesWithId(STATUS_PUBLIC_ID)

    const envelope = await getNotificationGroupsEnvelope(
      mockDatabase,
      [
        grouped({
          id: 'g1',
          groupKey: `like:${STATUS}`,
          statusId: STATUS,
          groupedActors: [ALICE],
          groupedCount: 1
        })
      ],
      'https://llun.test/users/me'
    )

    const [group] = envelope.notification_groups
    expect(group.sample_account_ids).toEqual([ALICE_PUBLIC_ID])
    expect(group.status_id).toBe(STATUS_PUBLIC_ID)
    // The ids the group references must exist in the envelope's own arrays.
    expect(envelope.accounts.map((account) => account.id)).toContain(
      ALICE_PUBLIC_ID
    )
    expect(envelope.statuses.map((status) => status.id)).toContain(
      STATUS_PUBLIC_ID
    )
  })

  it('returns empty accounts/statuses when there is nothing to resolve', async () => {
    const mockDatabase = {
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([]),
      getStatusesByIds: vi.fn(),
      getActorPublicIds: vi.fn(),
      getStatusPublicIds: vi.fn()
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

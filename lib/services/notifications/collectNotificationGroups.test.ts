import { Database } from '@/lib/database/types'
import { collectNotificationGroups } from '@/lib/services/notifications/collectNotificationGroups'
import { Notification, NotificationType } from '@/lib/types/database/operations'

const notif = (overrides: Partial<Notification>): Notification => ({
  id: 'n',
  actorId: 'https://llun.test/users/me',
  type: NotificationType.enum.like,
  sourceActorId: 'https://other.test/users/alice',
  isRead: false,
  filtered: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('collectNotificationGroups', () => {
  it('keeps fetching past a bursty group until it has `limit` groups', async () => {
    // First batch is entirely one big "like" group; later batches add new groups.
    const batch1 = Array.from({ length: 5 }, (_, i) =>
      notif({ id: `a${i}`, groupKey: 'like:s1', createdAt: 1000 - i })
    )
    const batch2 = [
      notif({
        id: 'b0',
        type: NotificationType.enum.reblog,
        groupKey: 'reblog:s2',
        createdAt: 900
      }),
      notif({
        id: 'b1',
        type: NotificationType.enum.follow,
        groupKey: 'follow',
        createdAt: 899
      })
      // Short batch (< batchSize) → source exhausted.
    ]
    const getNotifications = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
    const database = { getNotifications } as unknown as Database

    const result = await collectNotificationGroups({
      database,
      baseQuery: { actorId: 'https://llun.test/users/me' },
      limit: 3,
      batchSize: 5
    })

    // Two fetches: first (full batch) didn't yield 3 groups, second did/exhausted.
    expect(getNotifications).toHaveBeenCalledTimes(2)
    // Second fetch advanced the cursor to the last id of batch1.
    expect(getNotifications.mock.calls[1][0]).toMatchObject({
      maxNotificationId: 'a4'
    })
    expect(result.groups).toHaveLength(3)
    expect(result.exhausted).toBe(true)
    expect(result.rawNotifications).toHaveLength(7)
  })

  it('stops once `limit` groups are reached without over-scanning', async () => {
    const batch1 = [
      notif({ id: 'a', groupKey: 'like:s1', createdAt: 1000 }),
      notif({
        id: 'b',
        type: NotificationType.enum.reblog,
        groupKey: 'reblog:s2',
        createdAt: 999
      }),
      notif({
        id: 'c',
        type: NotificationType.enum.follow,
        groupKey: 'follow',
        createdAt: 998
      })
    ]
    const getNotifications = vi.fn().mockResolvedValue(batch1)
    const database = { getNotifications } as unknown as Database

    const result = await collectNotificationGroups({
      database,
      baseQuery: { actorId: 'https://llun.test/users/me' },
      limit: 2,
      batchSize: 3
    })

    // First full batch already yields >= 2 groups → no second fetch.
    expect(getNotifications).toHaveBeenCalledTimes(1)
    expect(result.groups.length).toBeGreaterThanOrEqual(2)
  })

  it('advances the cursor by the raw tail when account filtering empties a batch', async () => {
    const ALICE = 'https://other.test/users/alice'
    const BOB = 'https://other.test/users/bob'
    // First batch is all BOB (filtered out); second has the requested ALICE rows.
    const batch1 = Array.from({ length: 3 }, (_, i) =>
      notif({ id: `bob${i}`, sourceActorId: BOB, createdAt: 1000 - i })
    )
    const batch2 = [
      notif({ id: 'alice0', sourceActorId: ALICE, createdAt: 900 })
    ]
    const getNotifications = vi
      .fn()
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
    const database = { getNotifications } as unknown as Database

    const result = await collectNotificationGroups({
      database,
      baseQuery: { actorId: 'https://llun.test/users/me' },
      limit: 1,
      batchSize: 3,
      accountId: 'other.test:users:alice'
    })

    expect(getNotifications).toHaveBeenCalledTimes(2)
    // Cursor advanced past the all-BOB batch by its raw tail.
    expect(getNotifications.mock.calls[1][0]).toMatchObject({
      maxNotificationId: 'bob2'
    })
    expect(result.rawNotifications.map((n) => n.id)).toEqual(['alice0'])
  })

  it('respects the iteration cap to bound DB round-trips', async () => {
    // Every batch is the same one group; never reaches limit groups.
    let seq = 0
    const fullBatch = () =>
      Array.from({ length: 2 }, (_, i) => {
        seq += 1
        return notif({
          id: `x${seq}`,
          groupKey: 'like:s1',
          createdAt: 1000 - i
        })
      })
    const getNotifications = vi
      .fn()
      .mockImplementation(() => Promise.resolve(fullBatch()))
    const database = { getNotifications } as unknown as Database

    const result = await collectNotificationGroups({
      database,
      baseQuery: { actorId: 'https://llun.test/users/me' },
      limit: 10,
      batchSize: 2,
      maxIterations: 3
    })

    expect(getNotifications).toHaveBeenCalledTimes(3)
    expect(result.exhausted).toBe(false)
  })

  it('reports lastScannedId even when account filtering drops every row', async () => {
    const BOB = 'https://other.test/users/bob'
    // Two full batches entirely from BOB; the requested ALICE account matches none
    // within the iteration cap, so accumulation is empty but the scan progressed.
    let seq = 0
    const bobBatch = () =>
      Array.from({ length: 2 }, () => {
        seq += 1
        return notif({
          id: `bob${seq}`,
          sourceActorId: BOB,
          createdAt: 1000 - seq
        })
      })
    const getNotifications = vi
      .fn()
      .mockImplementation(() => Promise.resolve(bobBatch()))
    const database = { getNotifications } as unknown as Database

    const result = await collectNotificationGroups({
      database,
      baseQuery: { actorId: 'https://llun.test/users/me' },
      limit: 1,
      batchSize: 2,
      accountId: 'other.test:users:alice',
      maxIterations: 2
    })

    expect(result.rawNotifications).toHaveLength(0)
    expect(result.exhausted).toBe(false)
    // lastScannedId is the id of the last raw row scanned, so the caller can page on.
    expect(result.lastScannedId).toBe('bob4')
  })
})

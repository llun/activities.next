import { Database } from '@/lib/database/types'
import {
  GetBlockRelationsParams,
  GetMuteRelationsParams
} from '@/lib/types/database/operations'
import { Status, StatusType } from '@/lib/types/domain/status'

import { getFilteredStatusPage } from './getFilteredTimelinePage'

const readerActorId = 'https://llun.test/users/reader'
const blockedActorId = 'https://blocked.test/users/blocked'
const mutedActorId = 'https://muted.test/users/muted'

const createStatus = (name: string, actorId = readerActorId) =>
  ({
    id: `https://llun.test/users/reader/statuses/${name}`,
    actorId,
    type: StatusType.enum.Note
  }) as Status

describe('getFilteredStatusPage', () => {
  it('emits the last visible cursor mid-timeline when the page is full and more remain', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const visible4 = createStatus('visible-4')
    const visible5 = createStatus('visible-5')
    const visible6 = createStatus('visible-6')
    const batches = new Map<string | null, Status[]>([
      [null, [visible1, visible2, visible3]],
      [visible3.id, [visible4, visible5, visible6]]
    ])
    const getBlockRelations = jest.fn(async () => [])
    const getMuteRelations = jest.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database
    const fetchBatch = jest.fn(({ maxStatusId }) =>
      Promise.resolve(batches.get(maxStatusId) ?? [])
    )

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(visible3.id)
    expect(fetchBatch).toHaveBeenCalledTimes(1)
  })

  it('keeps a next cursor when a final exhausted batch buffers visible statuses', async () => {
    const blocked = createStatus('blocked', blockedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const visible4 = createStatus('visible-4')
    const batches = new Map<string | null, Status[]>([
      [null, [blocked, visible1, visible2]],
      [visible2.id, [visible3, visible4]]
    ])
    const getBlockRelations = jest.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = jest.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(visible3.id)
  })

  it('uses the last scanned cursor when a full page ends with blocked statuses', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const blocked1 = createStatus('blocked-1', blockedActorId)
    const blocked2 = createStatus('blocked-2', blockedActorId)
    const blocked3 = createStatus('blocked-3', blockedActorId)
    const batches = new Map<string | null, Status[]>([
      [null, [blocked1, visible1, visible2]],
      [visible2.id, [visible3, blocked2, blocked3]]
    ])
    const getBlockRelations = jest.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = jest.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBe(blocked3.id)
  })

  it('omits the next cursor when an exhausted batch exactly fills the visible page', async () => {
    const blocked = createStatus('blocked', blockedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const batches = new Map<string | null, Status[]>([
      [null, [blocked, visible1, visible2]],
      [visible2.id, [visible3]]
    ])
    const getBlockRelations = jest.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = jest.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBeNull()
  })

  it('uses the last scanned cursor when capped scans find fewer visible statuses than the limit', async () => {
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const batches = new Map<string | null, Status[]>([
      [
        null,
        [
          createStatus('blocked-1', blockedActorId),
          createStatus('blocked-2', blockedActorId),
          visible1
        ]
      ],
      [
        visible1.id,
        [
          createStatus('blocked-3', blockedActorId),
          createStatus('blocked-4', blockedActorId),
          createStatus('blocked-5', blockedActorId)
        ]
      ],
      [
        'https://llun.test/users/reader/statuses/blocked-5',
        [
          createStatus('blocked-6', blockedActorId),
          createStatus('blocked-7', blockedActorId),
          visible2
        ]
      ],
      [
        visible2.id,
        [
          createStatus('blocked-8', blockedActorId),
          createStatus('blocked-9', blockedActorId),
          createStatus('blocked-10', blockedActorId)
        ]
      ],
      [
        'https://llun.test/users/reader/statuses/blocked-10',
        [
          createStatus('blocked-11', blockedActorId),
          createStatus('blocked-12', blockedActorId),
          createStatus('blocked-13', blockedActorId)
        ]
      ]
    ])
    const getBlockRelations = jest.fn(
      async ({ targetActorIds }: GetBlockRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const getMuteRelations = jest.fn(async () => [])
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id
    ])
    expect(page.nextMaxStatusId).toBe(
      'https://llun.test/users/reader/statuses/blocked-13'
    )
  })

  it('omits statuses whose author the reader has muted', async () => {
    const muted = createStatus('muted', mutedActorId)
    const visible1 = createStatus('visible-1')
    const visible2 = createStatus('visible-2')
    const visible3 = createStatus('visible-3')
    const batches = new Map<string | null, Status[]>([
      [null, [muted, visible1, visible2]],
      [visible2.id, [visible3]]
    ])
    const getBlockRelations = jest.fn(async () => [])
    const getMuteRelations = jest.fn(
      async ({ targetActorIds }: GetMuteRelationsParams) =>
        targetActorIds.some((targetActorId) => targetActorId === mutedActorId)
          ? [
              {
                actorId: readerActorId,
                targetActorId: mutedActorId,
                notifications: true
              }
            ]
          : []
    )
    const database = {
      getBlockRelations,
      getMuteRelations
    } as unknown as Database

    const page = await getFilteredStatusPage({
      database,
      actorId: readerActorId,
      limit: 3,
      fetchBatch: ({ maxStatusId }) =>
        Promise.resolve(batches.get(maxStatusId) ?? [])
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      visible1.id,
      visible2.id,
      visible3.id
    ])
    expect(page.nextMaxStatusId).toBeNull()
  })
})

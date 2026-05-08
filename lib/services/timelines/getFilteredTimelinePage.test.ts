import { Database } from '@/lib/database/types'
import { GetBlockRelationsParams } from '@/lib/types/database/operations'
import { Status, StatusType } from '@/lib/types/domain/status'

import { getFilteredStatusPage } from './getFilteredTimelinePage'

const readerActorId = 'https://llun.test/users/reader'
const blockedActorId = 'https://blocked.test/users/blocked'

const createStatus = (name: string, actorId = readerActorId) =>
  ({
    id: `https://llun.test/users/reader/statuses/${name}`,
    actorId,
    type: StatusType.enum.Note
  }) as Status

describe('getFilteredStatusPage', () => {
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
        targetActorIds.includes(blockedActorId)
          ? [{ actorId: readerActorId, targetActorId: blockedActorId }]
          : []
    )
    const database = { getBlockRelations } as unknown as Database

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
})

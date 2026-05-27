import { Database } from '@/lib/database/types'
import { GetMuteRelationsParams } from '@/lib/types/database/operations'
import { Status, StatusType } from '@/lib/types/domain/status'

import { filterMutedStatuses } from './muteFilter'

const readerActorId = 'https://llun.test/users/reader'
const friendActorId = 'https://llun.test/users/friend'
const mutedActorId = 'https://muted.test/users/muted'

const createNoteStatus = (name: string, actorId: string) =>
  ({
    id: `https://llun.test/users/reader/statuses/${name}`,
    actorId,
    type: StatusType.enum.Note
  }) as Status

const createAnnounceStatus = (
  name: string,
  announcerActorId: string,
  originalActorId: string
) =>
  ({
    id: `https://llun.test/users/reader/statuses/${name}`,
    actorId: announcerActorId,
    type: StatusType.enum.Announce,
    originalStatus: {
      id: `${originalActorId}/statuses/original-${name}`,
      actorId: originalActorId,
      type: StatusType.enum.Note
    }
  }) as unknown as Status

describe('filterMutedStatuses', () => {
  it('returns statuses unchanged when no actorId is provided', async () => {
    const statuses = [createNoteStatus('one', mutedActorId)]
    const getMuteRelations = jest.fn()
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, undefined, statuses)

    expect(result).toBe(statuses)
    expect(getMuteRelations).not.toHaveBeenCalled()
  })

  it('returns an empty array unchanged without querying mute relations', async () => {
    const getMuteRelations = jest.fn()
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, readerActorId, [])

    expect(result).toEqual([])
    expect(getMuteRelations).not.toHaveBeenCalled()
  })

  it('filters out statuses whose author the reader has muted', async () => {
    const mutedStatus = createNoteStatus('muted', mutedActorId)
    const visibleStatus = createNoteStatus('visible', friendActorId)
    const getMuteRelations = jest.fn(
      async ({ actorIds, targetActorIds }: GetMuteRelationsParams) => {
        expect(actorIds).toEqual([readerActorId])
        const mutedActorIds = new Set([mutedActorId])
        return targetActorIds.some((id) => mutedActorIds.has(id))
          ? [
              {
                actorId: readerActorId,
                targetActorId: mutedActorId,
                notifications: true
              }
            ]
          : []
      }
    )
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, readerActorId, [
      mutedStatus,
      visibleStatus
    ])

    expect(result.map((status) => status.id)).toEqual([visibleStatus.id])
  })

  it('filters out announces of a muted original author', async () => {
    const announceOfMuted = createAnnounceStatus(
      'announce-muted',
      friendActorId,
      mutedActorId
    )
    const visibleAnnounce = createAnnounceStatus(
      'announce-visible',
      friendActorId,
      friendActorId
    )
    const getMuteRelations = jest.fn(async () => [
      {
        actorId: readerActorId,
        targetActorId: mutedActorId,
        notifications: true
      }
    ])
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, readerActorId, [
      announceOfMuted,
      visibleAnnounce
    ])

    expect(result.map((status) => status.id)).toEqual([visibleAnnounce.id])
  })

  it('keeps statuses whose authors are unrelated to any mute relation', async () => {
    const visibleA = createNoteStatus('a', friendActorId)
    const visibleB = createNoteStatus('b', readerActorId)
    const getMuteRelations = jest.fn(async () => [])
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, readerActorId, [
      visibleA,
      visibleB
    ])

    expect(result.map((status) => status.id)).toEqual([
      visibleA.id,
      visibleB.id
    ])
  })

  it('hides statuses even when mute has notifications=false (timeline ignores notifications flag)', async () => {
    const mutedStatus = createNoteStatus('muted', mutedActorId)
    const getMuteRelations = jest.fn(async () => [
      {
        actorId: readerActorId,
        targetActorId: mutedActorId,
        notifications: false
      }
    ])
    const database = { getMuteRelations } as unknown as Database

    const result = await filterMutedStatuses(database, readerActorId, [
      mutedStatus
    ])

    expect(result).toHaveLength(0)
  })

  it('only queries directional relations (muter -> target) for the reader', async () => {
    const status = createNoteStatus('one', friendActorId)
    const getMuteRelations = jest.fn(async () => [])
    const database = { getMuteRelations } as unknown as Database

    await filterMutedStatuses(database, readerActorId, [status])

    expect(getMuteRelations).toHaveBeenCalledTimes(1)
    expect(getMuteRelations).toHaveBeenCalledWith({
      actorIds: [readerActorId],
      targetActorIds: [friendActorId]
    })
  })
})

import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { resolveStatusFromPath } from './resolveStatusFromPath'

describe('resolveStatusFromPath', () => {
  const originalActorId = 'https://remote.example/users/original'
  const boosterActorId = 'https://boost.example/users/booster'
  const secondBoosterActorId = 'https://other.example/users/booster'
  const originalUrl = 'https://remote.example/@original/123'
  const statusHash = getHashFromString(originalUrl)

  const originalStatus = {
    id: 'https://remote.example/users/original/statuses/123',
    url: originalUrl,
    actorId: originalActorId,
    actor: {
      username: 'original',
      domain: 'remote.example'
    },
    type: StatusType.enum.Note,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    text: 'Original status',
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    attachments: [],
    tags: []
  } as Status

  const createAnnounce = (actorId = boosterActorId) =>
    ({
      id: `${actorId}/statuses/456/activity`,
      actorId,
      actor: {
        username: 'booster',
        domain: new URL(actorId).host
      },
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      originalStatus,
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }) as Status

  const createDatabase = () => ({
    getActorFromUsername: jest.fn().mockResolvedValue({ id: originalActorId }),
    getStatusFromUrlHash: jest.fn().mockResolvedValue(null),
    getStatus: jest.fn().mockResolvedValue(null)
  })

  it('resolves a hash route from the scoped actor lookup', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash.mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).toHaveBeenCalledTimes(1)
    expect(database.getStatusFromUrlHash).toHaveBeenCalledWith({
      urlHash: statusHash,
      actorId: originalActorId
    })
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('resolves a boosted hash route to the original status when the path actor owns it', async () => {
    const database = createDatabase()
    const boostedStatus = createAnnounce()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(boostedStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(1, {
      urlHash: statusHash,
      actorId: originalActorId
    })
    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(2, {
      urlHash: statusHash
    })
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('returns the original status when an unscoped hash lookup finds another boost of the same status', async () => {
    const database = createDatabase()
    const secondBoostedStatus = createAnnounce(secondBoosterActorId)
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(secondBoostedStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })
  })

  it('does not resolve an unscoped hash when a note belongs to a different actor', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...originalStatus,
        actorId: 'https://other.example/users/someone'
      })

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: null,
      statusId: ''
    })
  })

  it('does not resolve an unscoped hash when an announce original belongs to a different actor', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...createAnnounce(),
        originalStatus: {
          ...originalStatus,
          actorId: 'https://other.example/users/someone'
        }
      })

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: null,
      statusId: ''
    })
  })

  it('returns null when the actor route is malformed', async () => {
    const database = createDatabase()

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: 'plain-username',
        statusParam: statusHash
      })
    ).resolves.toBeNull()

    expect(database.getActorFromUsername).not.toHaveBeenCalled()
    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('returns null when the actor route has malformed URI escapes', async () => {
    const database = createDatabase()

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '%E0%A4%A',
        statusParam: statusHash
      })
    ).resolves.toBeNull()

    expect(database.getActorFromUsername).not.toHaveBeenCalled()
    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('falls back from full status id to raw id for non-hash status params', async () => {
    const database = createDatabase()
    database.getStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: '123'
      })
    ).resolves.toEqual({
      fullStatusId: 'https://remote.example/users/original/statuses/123',
      isStatusHash: false,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).toHaveBeenNthCalledWith(1, {
      statusId: 'https://remote.example/users/original/statuses/123',
      withReplies: false
    })
    expect(database.getStatus).toHaveBeenNthCalledWith(2, {
      statusId: '123',
      withReplies: false
    })
  })

  it('resolves full URL status params without raw id fallback', async () => {
    const database = createDatabase()
    database.getStatus.mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: originalStatus.id
      })
    ).resolves.toEqual({
      fullStatusId: originalStatus.id,
      isStatusHash: false,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).toHaveBeenCalledTimes(1)
    expect(database.getStatus).toHaveBeenCalledWith({
      statusId: originalStatus.id,
      withReplies: false
    })
  })
})

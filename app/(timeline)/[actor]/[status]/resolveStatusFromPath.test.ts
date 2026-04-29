import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { resolveStatusFromPath } from './resolveStatusFromPath'

describe('#resolveStatusFromPath', () => {
  const originalActorId = 'https://remote.example/users/original'
  const boosterActorId = 'https://boost.example/users/booster'
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

  const boostedStatus = {
    id: 'https://boost.example/users/booster/statuses/456/activity',
    actorId: boosterActorId,
    actor: {
      username: 'booster',
      domain: 'boost.example'
    },
    type: StatusType.enum.Announce,
    to: [],
    cc: [],
    edits: [],
    originalStatus,
    isLocalActor: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  } as Status

  it('resolves a hash route when the stored row actor is the booster and the path actor owns the original status', async () => {
    const database = {
      getActorFromUsername: jest
        .fn()
        .mockResolvedValue({ id: originalActorId }),
      getStatusFromUrlHash: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(boostedStatus),
      getStatus: jest.fn().mockResolvedValue(null)
    }

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId:
        'https://remote.example/users/original/statuses/' + statusHash,
      isStatusHash: true,
      status: boostedStatus,
      statusId: boostedStatus.id
    })

    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(1, {
      urlHash: statusHash,
      actorId: originalActorId
    })
    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(2, {
      urlHash: statusHash
    })
  })

  it('does not resolve an unscoped hash when neither the status nor original status belongs to the path actor', async () => {
    const database = {
      getActorFromUsername: jest
        .fn()
        .mockResolvedValue({ id: originalActorId }),
      getStatusFromUrlHash: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...originalStatus,
          actorId: 'https://other.example/users/someone'
        }),
      getStatus: jest.fn().mockResolvedValue(null)
    }

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId:
        'https://remote.example/users/original/statuses/' + statusHash,
      isStatusHash: true,
      status: null,
      statusId: ''
    })
  })
})

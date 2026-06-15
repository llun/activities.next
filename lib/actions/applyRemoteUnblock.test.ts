import { Database } from '@/lib/database/types'

import { applyRemoteUnblock } from './applyRemoteUnblock'

const createDatabase = () => ({
  deleteBlock: vi.fn(),
  deleteBlockByUri: vi.fn(),
  getBlockByUri: vi.fn()
})

const createStoredBlock = () => ({
  id: 'block-1',
  actorId: 'https://remote.test/users/alice',
  actorHost: 'remote.test',
  targetActorId: 'https://activities.local/users/llun',
  targetActorHost: 'activities.local',
  uri: 'https://remote.test/users/alice#blocks/1',
  createdAt: 1,
  updatedAt: 1
})

describe('applyRemoteUnblock', () => {
  it('preserves raw Undo Block actor ids when deleting a full object fallback', async () => {
    const database = createDatabase()
    const storedBlock = {
      ...createStoredBlock(),
      actorId: 'https://REMOTE.test/users/alice#activity'
    }
    database.getBlockByUri.mockResolvedValue(null)
    database.deleteBlock.mockResolvedValue(storedBlock)

    const result = await applyRemoteUnblock({
      database: database as unknown as Database,
      actorId: 'https://remote.test/users/alice',
      object: {
        id: 'https://remote.test/users/alice#blocks/1',
        type: 'Block',
        actor: 'https://REMOTE.test/users/alice#activity',
        object: 'https://activities.local/users/llun'
      },
      targetActorId: 'https://activities.local/users/llun'
    })

    expect(result).toEqual(storedBlock)
    expect(database.deleteBlock).toHaveBeenCalledWith({
      actorId: 'https://REMOTE.test/users/alice#activity',
      targetActorId: 'https://activities.local/users/llun'
    })
  })

  it('falls back to normalized actor ids when raw fallback pairs miss', async () => {
    const database = createDatabase()
    const storedBlock = createStoredBlock()
    database.getBlockByUri.mockResolvedValue(null)
    database.deleteBlock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedBlock)

    const result = await applyRemoteUnblock({
      database: database as unknown as Database,
      actorId: 'https://REMOTE.test/users/alice#activity',
      object: {
        id: 'https://remote.test/users/alice#blocks/1',
        type: 'Block',
        actor: 'https://remote.test/users/alice',
        object: {
          id: 'https://ACTIVITIES.local/users/llun#target'
        }
      },
      targetActorId: 'https://activities.local/users/llun'
    })

    expect(result).toEqual(storedBlock)
    expect(database.deleteBlock).toHaveBeenNthCalledWith(1, {
      actorId: 'https://remote.test/users/alice',
      targetActorId: 'https://ACTIVITIES.local/users/llun#target'
    })
    expect(database.deleteBlock).toHaveBeenNthCalledWith(2, {
      actorId: 'https://REMOTE.test/users/alice#activity',
      targetActorId: 'https://activities.local/users/llun'
    })
    expect(database.deleteBlock).toHaveBeenNthCalledWith(3, {
      actorId: 'https://remote.test/users/alice',
      targetActorId: 'https://activities.local/users/llun'
    })
  })

  it('uses the stored actor id when deleting a reference Undo Block by URI', async () => {
    const database = createDatabase()
    const storedBlock = createStoredBlock()
    database.getBlockByUri.mockResolvedValue(storedBlock)
    database.deleteBlockByUri.mockResolvedValue(storedBlock)

    const result = await applyRemoteUnblock({
      database: database as unknown as Database,
      actorId: 'https://REMOTE.test/users/alice#activity',
      object: storedBlock.uri,
      targetActorId: 'https://activities.local/users/llun#target'
    })

    expect(result).toEqual(storedBlock)
    expect(database.deleteBlockByUri).toHaveBeenCalledWith({
      actorId: storedBlock.actorId,
      uri: storedBlock.uri
    })
  })

  it('rejects Undo Block objects with a different normalized actor id', async () => {
    const database = createDatabase()

    const result = await applyRemoteUnblock({
      database: database as unknown as Database,
      actorId: 'https://remote.test/users/alice',
      object: {
        id: 'https://remote.test/users/bob#blocks/1',
        type: 'Block',
        actor: 'https://remote.test/users/bob',
        object: 'https://activities.local/users/llun'
      },
      targetActorId: 'https://activities.local/users/llun'
    })

    expect(result).toBeNull()
    expect(database.deleteBlock).not.toHaveBeenCalled()
    expect(database.deleteBlockByUri).not.toHaveBeenCalled()
  })
})

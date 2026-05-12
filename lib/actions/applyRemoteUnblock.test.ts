import { Database } from '@/lib/database/types'

import { applyRemoteUnblock } from './applyRemoteUnblock'

const createDatabase = () => ({
  deleteBlock: jest.fn(),
  deleteBlockByUri: jest.fn(),
  getBlockByUri: jest.fn()
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
  it('normalizes actor ids before deleting a full Undo Block object', async () => {
    const database = createDatabase()
    database.getBlockByUri.mockResolvedValue(null)
    database.deleteBlock.mockResolvedValue(createStoredBlock())

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

    expect(result).toEqual(createStoredBlock())
    expect(database.deleteBlock).toHaveBeenCalledWith({
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

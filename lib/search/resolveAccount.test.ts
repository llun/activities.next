import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'

import { resolveAccountForSearch } from './resolveAccount'

jest.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: jest.fn()
}))

jest.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: jest.fn()
}))

jest.mock('@/lib/config/configuredHost', () => ({
  getConfiguredHost: () => 'local.test'
}))

describe('resolveAccountForSearch', () => {
  const mockRecordActorIfNeeded = recordActorIfNeeded as jest.MockedFunction<
    typeof recordActorIfNeeded
  >
  const mockGetWebfingerSelf = getWebfingerSelf as jest.MockedFunction<
    typeof getWebfingerSelf
  >

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves URL-form account queries from existing actors', async () => {
    const database = {
      getActorFromUsername: jest.fn().mockResolvedValue({
        id: 'https://remote.test/users/alice'
      }),
      upsertActorSearchDocument: jest.fn()
    }

    await expect(
      resolveAccountForSearch({
        database: database as never,
        query: 'https://remote.test/@alice'
      })
    ).resolves.toBe('https://remote.test/users/alice')

    expect(database.getActorFromUsername).toHaveBeenCalledWith({
      username: 'alice',
      domain: 'remote.test'
    })
    expect(database.upsertActorSearchDocument).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/alice'
    })
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })

  it('uses WebFinger for unknown URL-form account queries', async () => {
    const database = {
      getActorFromUsername: jest.fn().mockResolvedValue(null),
      upsertActorSearchDocument: jest.fn()
    }
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/alice')
    mockRecordActorIfNeeded.mockResolvedValue({
      id: 'https://remote.test/users/alice'
    } as never)

    await expect(
      resolveAccountForSearch({
        database: database as never,
        query: 'https://remote.test/users/alice'
      })
    ).resolves.toBe('https://remote.test/users/alice')

    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'alice@remote.test'
    })
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/alice',
      database
    })
    expect(database.upsertActorSearchDocument).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/alice'
    })
  })
})

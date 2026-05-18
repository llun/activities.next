import knex, { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import {
  deleteMeilisearchDocument,
  deleteMeilisearchDocuments,
  writeMeilisearchDocuments
} from '@/lib/search/meilisearch'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn()
}))

jest.mock('@/lib/search/meilisearch', () => ({
  deleteMeilisearchDocument: jest.fn(),
  deleteMeilisearchDocuments: jest.fn(),
  writeMeilisearchDocuments: jest.fn()
}))

describe('SearchSQLDatabase Meilisearch synchronization', () => {
  const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
  const mockWriteMeilisearchDocuments =
    writeMeilisearchDocuments as jest.MockedFunction<
      typeof writeMeilisearchDocuments
    >
  const mockDeleteMeilisearchDocument =
    deleteMeilisearchDocument as jest.MockedFunction<
      typeof deleteMeilisearchDocument
    >
  const mockDeleteMeilisearchDocuments =
    deleteMeilisearchDocuments as jest.MockedFunction<
      typeof deleteMeilisearchDocuments
    >

  let rawDatabase: Knex
  let database: Database
  const flushQueuedMeilisearchSync = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockGetConfig.mockReturnValue({
      host: 'local.test',
      search: {
        backend: 'meilisearch',
        url: 'https://search.test',
        indexPrefix: 'activities_next',
        timeoutMs: 2000
      }
    } as ReturnType<typeof getConfig>)
    mockWriteMeilisearchDocuments.mockResolvedValue(undefined)
    mockDeleteMeilisearchDocument.mockResolvedValue(undefined)
    mockDeleteMeilisearchDocuments.mockResolvedValue(undefined)

    rawDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    database = getSQLDatabase(rawDatabase)
    await database.migrate()
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('publishes account search document writes to Meilisearch', async () => {
    const actorId = 'https://remote.test/users/alice'

    await database.createMastodonActor({
      actorId,
      username: 'alice',
      domain: 'remote.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `${actorId}/inbox`,
      publicKey: 'public-key',
      createdAt: Date.now()
    })
    await flushQueuedMeilisearchSync()

    expect(mockWriteMeilisearchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounts',
        documents: [
          expect.objectContaining({
            entityId: actorId,
            entityType: 'accounts',
            text: expect.stringContaining('alice')
          })
        ]
      })
    )
  })

  it('publishes search document deletes and clears to Meilisearch', async () => {
    const actorId = 'https://remote.test/users/alice'

    await database.deleteSearchDocument({
      entityType: 'account',
      entityId: actorId
    })
    await database.clearSearchIndex()
    await flushQueuedMeilisearchSync()

    expect(mockDeleteMeilisearchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounts',
        documentId: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    )
    expect(mockDeleteMeilisearchDocuments).toHaveBeenCalledTimes(3)
  })
})

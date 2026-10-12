import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'

import {
  backfillMissingLikeActors,
  findMissingLikeActorIds,
  parseArgs
} from './backfillMissingLikeActors'

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: vi.fn()
}))

vi.mock('@/lib/services/mastodon/resolveClientId', () => ({
  resolveStatusIdParam: vi.fn()
}))

describe('backfillMissingLikeActors parseArgs', () => {
  it('defaults to live run with default batch size and no status filter', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      batchSize: 50,
      statusId: undefined
    })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(parseArgs(['--dry-run'])).toEqual({
      dryRun: true,
      batchSize: 50,
      statusId: undefined
    })
    expect(parseArgs(['--dry-run=false'])).toEqual({
      dryRun: false,
      batchSize: 50,
      statusId: undefined
    })
    expect(parseArgs(['--dry-run', 'true'])).toEqual({
      dryRun: true,
      batchSize: 50,
      statusId: undefined
    })
  })

  it('accepts batch-size inline or space-separated', () => {
    expect(parseArgs(['--batch-size', '10'])).toEqual({
      dryRun: false,
      batchSize: 10,
      statusId: undefined
    })
    expect(parseArgs(['--batch-size=25'])).toEqual({
      dryRun: false,
      batchSize: 25,
      statusId: undefined
    })
  })

  it('accepts status-id inline or space-separated', () => {
    expect(parseArgs(['--status-id', 'test-status'])).toEqual({
      dryRun: false,
      batchSize: 50,
      statusId: 'test-status'
    })
    expect(parseArgs(['--status-id=test-status-2'])).toEqual({
      dryRun: false,
      batchSize: 50,
      statusId: 'test-status-2'
    })
  })

  it.each([
    { description: 'a non-flag argument', args: ['status-id'] },
    { description: 'an unknown flag', args: ['--unknown'] },
    {
      description: 'an invalid boolean flag value',
      args: ['--dry-run', 'invalid']
    },
    { description: 'a zero batch size', args: ['--batch-size', '0'] },
    { description: 'a negative batch size', args: ['--batch-size', '-5'] },
    { description: 'a non-integer batch size', args: ['--batch-size', '1.5'] },
    { description: 'a batch size with no value', args: ['--batch-size'] },
    { description: 'a status-id with no value', args: ['--status-id'] }
  ])('rejects $description', ({ args }) => {
    expect(() => parseArgs(args)).toThrow()
  })
})

// The real `likes` and `actors` tables, from the same schema dump the app
// migrates with. Honours TEST_DATABASE_TYPE, so it runs on PostgreSQL in CI.
describe('findMissingLikeActorIds', () => {
  const testDb = createTestDatabase()
  const { db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  beforeEach(async () => {
    await db.deleteFrom('likes').execute()
    await db.deleteFrom('actors').execute()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('returns actorIds that exist in likes but not in actors', async () => {
    await db
      .insertInto('actors')
      .values([
        { id: 'https://remote.test/users/known1' },
        { id: 'https://remote.test/users/known2' }
      ])
      .execute()

    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/known1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing2',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing1',
          statusId: 'https://local.test/status/2'
        }
      ])
      .execute()

    const missing = await findMissingLikeActorIds(db)
    expect(missing.sort()).toEqual([
      'https://remote.test/users/missing1',
      'https://remote.test/users/missing2'
    ])
  })

  it('filters by statusId when specified', async () => {
    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/missing1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing2',
          statusId: 'https://local.test/status/2'
        }
      ])
      .execute()

    const missing = await findMissingLikeActorIds(db, {
      statusId: 'https://local.test/status/1'
    })
    expect(missing).toEqual(['https://remote.test/users/missing1'])
  })

  it('respects limit when specified', async () => {
    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/missing1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing2',
          statusId: 'https://local.test/status/2'
        },
        {
          actorId: 'https://remote.test/users/missing3',
          statusId: 'https://local.test/status/3'
        }
      ])
      .execute()

    const missing = await findMissingLikeActorIds(db, { limit: 2 })
    expect(missing).toHaveLength(2)
  })
})

describe('backfillMissingLikeActors', () => {
  const testDb = createTestDatabase()
  const { db } = testDb
  const fakeDatabase = {} as Database

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(recordActorIfNeeded).mockReset()
    vi.mocked(resolveStatusIdParam).mockReset()

    await db.deleteFrom('likes').execute()
    await db.deleteFrom('actors').execute()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('does not record actors in dry-run mode', async () => {
    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/missing1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/missing2',
          statusId: 'https://local.test/status/1'
        }
      ])
      .execute()

    const result = await backfillMissingLikeActors({
      database: fakeDatabase,
      db,
      dryRun: true
    })

    expect(result).toEqual({ found: 2, recorded: 0, failed: 0 })
    expect(recordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('fetches and records missing actors in live mode', async () => {
    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/actor1',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/actor2',
          statusId: 'https://local.test/status/1'
        },
        {
          actorId: 'https://remote.test/users/actor3',
          statusId: 'https://local.test/status/1'
        }
      ])
      .execute()

    vi.mocked(recordActorIfNeeded).mockImplementation(
      async ({ actorId }: { actorId: string }) => {
        if (actorId.endsWith('actor1')) {
          return { id: actorId, username: 'actor1' } as never
        }
        if (actorId.endsWith('actor2')) {
          return undefined
        }
        throw new Error('Network error')
      }
    )

    const result = await backfillMissingLikeActors({
      database: fakeDatabase,
      db,
      dryRun: false,
      batchSize: 2
    })

    expect(result).toEqual({ found: 3, recorded: 1, failed: 2 })
    expect(recordActorIfNeeded).toHaveBeenCalledTimes(3)
  })

  it('resolves statusId parameter when filtering by status', async () => {
    vi.mocked(resolveStatusIdParam).mockResolvedValue(
      'https://local.test/statuses/resolved-1'
    )
    await db
      .insertInto('likes')
      .values([
        {
          actorId: 'https://remote.test/users/actor1',
          statusId: 'https://local.test/statuses/resolved-1'
        },
        {
          actorId: 'https://remote.test/users/actor2',
          statusId: 'https://local.test/statuses/resolved-2'
        }
      ])
      .execute()

    vi.mocked(recordActorIfNeeded).mockResolvedValue({
      id: 'https://remote.test/users/actor1',
      username: 'actor1'
    } as never)

    const result = await backfillMissingLikeActors({
      database: fakeDatabase,
      db,
      dryRun: false,
      statusId: 'public-id-1'
    })

    expect(resolveStatusIdParam).toHaveBeenCalledWith(
      fakeDatabase,
      'public-id-1'
    )
    expect(result).toEqual({ found: 1, recorded: 1, failed: 0 })
    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/actor1',
      database: fakeDatabase
    })
  })
})

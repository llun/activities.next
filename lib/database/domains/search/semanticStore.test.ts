import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createSearchActor,
  seedStatus
} from '@/lib/database/testing/searchTestHelpers'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  compareVersions,
  parseHalfvecDimensions,
  readSemanticAvailability,
  resetSemanticAvailabilityCache
} from './semanticStore'

describe('compareVersions', () => {
  it.each([
    {
      description: 'equal three-part versions',
      left: '0.8.0',
      right: '0.8.0',
      sign: 0
    },
    {
      description: 'trailing zero omitted',
      left: '0.8',
      right: '0.8.0',
      sign: 0
    },
    {
      description: 'newer patch version',
      left: '0.8.7',
      right: '0.8.0',
      sign: 1
    },
    {
      description: 'older minor version',
      left: '0.7.9',
      right: '0.8.0',
      sign: -1
    },
    {
      description: 'multi-digit minor comparison',
      left: '0.10.0',
      right: '0.8.0',
      sign: 1
    },
    {
      description: 'newer major beats higher minor',
      left: '1.0.0',
      right: '0.99.9',
      sign: 1
    },
    {
      description: 'non-numeric segment reads as zero',
      left: '0.8.0-rc1',
      right: '0.8.0',
      sign: 0
    }
  ])('$description', ({ left, right, sign }) => {
    expect(Math.sign(compareVersions(left, right))).toBe(sign)
  })
})

describe('parseHalfvecDimensions', () => {
  it.each([
    {
      description: 'standard 768 dimensions',
      type: 'halfvec(768)',
      expected: 768
    },
    { description: 'small 8 dimensions', type: 'halfvec(8)', expected: 8 },
    {
      description: 'max 4000 dimensions',
      type: 'halfvec(4000)',
      expected: 4000
    },
    { description: 'null input', type: null, expected: null },
    { description: 'empty string', type: '', expected: null },
    {
      description: 'vector type instead of halfvec',
      type: 'vector(768)',
      expected: null
    },
    { description: 'unbounded halfvec', type: 'halfvec', expected: null },
    {
      description: 'non-numeric dimension',
      type: 'halfvec(abc)',
      expected: null
    },
    {
      description: 'trailing characters',
      type: 'halfvec(768)[]',
      expected: null
    }
  ])('$description', ({ type, expected }) => {
    expect(parseHalfvecDimensions(type)).toBe(expected)
  })
})

describe('readSemanticAvailability without pgvector setup', () => {
  const testDb = createTestDatabase()
  const { database, db, backend } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    resetSemanticAvailabilityCache()
    await database.destroy()
  })

  it('returns unavailable without throwing when semantic search is not set up', async () => {
    const availability = await readSemanticAvailability(db, 8)
    expect(availability.available).toBe(false)
    if (!availability.available) {
      if (backend === 'sqlite') {
        expect(availability.reason).toContain('not PostgreSQL')
      } else {
        expect(availability.reason).toContain('pgvector')
      }
    }
  })

  it('keeps keyword search unchanged when semantic is absent or unavailable', async () => {
    const actorId = 'https://sem-fallback.test/users/alice'
    const matchId = `${actorId}/statuses/keyword-hit`
    const otherId = `${actorId}/statuses/other-post`

    await createSearchActor(database, {
      id: actorId,
      username: 'alice',
      domain: 'sem-fallback.test'
    })
    await seedStatus(db, {
      id: matchId,
      actorId,
      createdAt: 1000,
      text: 'mountain trail running shoes',
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await seedStatus(db, {
      id: otherId,
      actorId,
      createdAt: 2000,
      text: 'espresso roast notes',
      to: [ACTIVITY_STREAM_PUBLIC]
    })
    await database.indexStatusSearchDocument({ statusId: matchId })
    await database.indexStatusSearchDocument({ statusId: otherId })

    const withoutSemantic = await database.searchStatusIds({
      q: 'mountain',
      sort: 'relevance',
      limit: 10,
      currentActorId: actorId
    })
    expect(withoutSemantic).toEqual([matchId])

    const withSemantic = await database.searchStatusIds({
      q: 'mountain',
      sort: 'relevance',
      limit: 10,
      currentActorId: actorId,
      semantic: {
        embedding: [1, 0, 0, 0, 0, 0, 0, 0],
        model: 'fake-embed',
        dimensions: 8
      }
    })
    expect(withSemantic).toEqual([matchId])
  })
})

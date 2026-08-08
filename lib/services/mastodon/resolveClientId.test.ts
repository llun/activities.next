import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import {
  resolveActorIdParam,
  resolveActorIdParams,
  resolveStatusIdParam,
  resolveStatusIdParams
} from './resolveClientId'

// SQLite (what this suite runs on) and PostgreSQL compare `publicId` case
// SENSITIVELY; MySQL's default utf8mb4_0900_ai_ci collation does not, and the
// row it matches comes back carrying the publicId as STORED rather than as
// requested. The two stubs below simulate that collation and nothing else — they
// are not a second database implementation, only the one behavior a real test
// database cannot produce.
const matchesIgnoringCase = (requested: string, stored: string) =>
  requested.toLowerCase() === stored.toLowerCase()

const createCaseInsensitiveStatusDatabase = (
  storedPublicId: string,
  statusId: string
): Pick<Database, 'getStatusIdByPublicId' | 'getStatusIdsByPublicIds'> => ({
  getStatusIdByPublicId: async ({ publicId }) =>
    matchesIgnoringCase(publicId, storedPublicId) ? statusId : null,
  getStatusIdsByPublicIds: async ({ publicIds }) =>
    new Map<string, string>(
      publicIds
        .filter((publicId) => matchesIgnoringCase(publicId, storedPublicId))
        .map((): [string, string] => [storedPublicId, statusId])
    )
})

const createCaseInsensitiveActorDatabase = (
  storedPublicId: string,
  actorId: string
): Pick<Database, 'getActorIdByPublicId' | 'getActorIdsByPublicIds'> => ({
  getActorIdByPublicId: async ({ publicId }) =>
    matchesIgnoringCase(publicId, storedPublicId) ? actorId : null,
  getActorIdsByPublicIds: async ({ publicIds }) =>
    new Map<string, string>(
      publicIds
        .filter((publicId) => matchesIgnoringCase(publicId, storedPublicId))
        .map((): [string, string] => [storedPublicId, actorId])
    )
})

describe('resolveStatusIdParam', () => {
  const database = getTestSQLDatabase()
  const statusUrl = `${ACTOR1_ID}/statuses/post-1`
  let statusPublicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const status = await database.getStatus({ statusId: statusUrl })
    if (!status?.publicId) {
      throw new Error('seeded status is missing a publicId')
    }
    statusPublicId = status.publicId
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('passes a raw status URI through unchanged', async () => {
    await expect(resolveStatusIdParam(database, statusUrl)).resolves.toBe(
      statusUrl
    )
  })

  it('decodes the colon form of a seeded status to its URI', async () => {
    await expect(
      resolveStatusIdParam(database, urlToId(statusUrl))
    ).resolves.toBe(statusUrl)
  })

  it("resolves the seeded status's real publicId to its URI", async () => {
    await expect(resolveStatusIdParam(database, statusPublicId)).resolves.toBe(
      statusUrl
    )
  })

  it('resolves an uppercased publicId to the same URI as its stored lowercase form', async () => {
    await expect(
      resolveStatusIdParam(database, statusPublicId.toUpperCase())
    ).resolves.toBe(statusUrl)
  })

  it('returns a fresh publicId that was never stored unchanged', async () => {
    const unknownPublicId = generatePublicId()
    await expect(resolveStatusIdParam(database, unknownPublicId)).resolves.toBe(
      unknownPublicId
    )
  })

  it('returns an empty string unchanged', async () => {
    await expect(resolveStatusIdParam(database, '')).resolves.toBe('')
  })
})

describe('resolveActorIdParam', () => {
  const database = getTestSQLDatabase()
  let actorPublicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    if (!actor?.publicId) {
      throw new Error('seeded actor is missing a publicId')
    }
    actorPublicId = actor.publicId
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('passes a raw actor URI through unchanged', async () => {
    await expect(resolveActorIdParam(database, ACTOR1_ID)).resolves.toBe(
      ACTOR1_ID
    )
  })

  it('decodes the colon form of a seeded actor to its URI', async () => {
    await expect(
      resolveActorIdParam(database, urlToId(ACTOR1_ID))
    ).resolves.toBe(ACTOR1_ID)
  })

  it("resolves the seeded actor's real publicId to its URI", async () => {
    await expect(resolveActorIdParam(database, actorPublicId)).resolves.toBe(
      ACTOR1_ID
    )
  })

  it('resolves an uppercased publicId to the same URI as its stored lowercase form', async () => {
    await expect(
      resolveActorIdParam(database, actorPublicId.toUpperCase())
    ).resolves.toBe(ACTOR1_ID)
  })

  it('returns a fresh publicId that was never stored unchanged', async () => {
    const unknownPublicId = generatePublicId()
    await expect(resolveActorIdParam(database, unknownPublicId)).resolves.toBe(
      unknownPublicId
    )
  })

  it('returns an empty string unchanged', async () => {
    await expect(resolveActorIdParam(database, '')).resolves.toBe('')
  })
})

describe('resolveStatusIdParams', () => {
  const database = getTestSQLDatabase()
  const firstStatusUrl = `${ACTOR1_ID}/statuses/post-1`
  const secondStatusUrl = `${ACTOR1_ID}/statuses/post-2`
  let firstPublicId: string
  let secondPublicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const first = await database.getStatus({ statusId: firstStatusUrl })
    const second = await database.getStatus({ statusId: secondStatusUrl })
    if (!first?.publicId || !second?.publicId) {
      throw new Error('seeded statuses are missing publicIds')
    }
    firstPublicId = first.publicId
    secondPublicId = second.publicId
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns an empty array without querying the database', async () => {
    const spy = vi.spyOn(database, 'getStatusIdsByPublicIds')
    await expect(resolveStatusIdParams(database, [])).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('resolves every id form in one array and preserves input order', async () => {
    const unknownPublicId = generatePublicId()
    await expect(
      resolveStatusIdParams(database, [
        firstStatusUrl,
        secondPublicId,
        urlToId(firstStatusUrl),
        unknownPublicId
      ])
    ).resolves.toEqual([
      firstStatusUrl,
      secondStatusUrl,
      firstStatusUrl,
      unknownPublicId
    ])
  })

  it('preserves duplicates and length while looking each publicId up once', async () => {
    const spy = vi.spyOn(database, 'getStatusIdsByPublicIds')
    const params = [firstPublicId, secondPublicId, firstPublicId]
    await expect(resolveStatusIdParams(database, params)).resolves.toEqual([
      firstStatusUrl,
      secondStatusUrl,
      firstStatusUrl
    ])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      publicIds: [firstPublicId, secondPublicId]
    })
    spy.mockRestore()
  })

  it('issues a single lookup no matter how many publicIds are requested', async () => {
    const spy = vi.spyOn(database, 'getStatusIdsByPublicIds')
    const params = Array.from({ length: 50 }, () => generatePublicId())
    const resolved = await resolveStatusIdParams(database, params)
    expect(resolved).toEqual(params)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('matches the single-id resolver for every element', async () => {
    const params = [
      firstStatusUrl,
      firstPublicId,
      urlToId(secondStatusUrl),
      generatePublicId(),
      firstPublicId.toUpperCase(),
      ''
    ]
    await expect(resolveStatusIdParams(database, params)).resolves.toEqual(
      await Promise.all(
        params.map((param) => resolveStatusIdParam(database, param))
      )
    )
  })

  // The stored/requested casings are thunks because the seeded publicIds only
  // exist once beforeAll has run, while the table is built at collection time.
  it.each([
    {
      description: 'the request is uppercased',
      storedPublicId: () => firstPublicId,
      requestedPublicId: () => firstPublicId.toUpperCase()
    },
    {
      description: 'the stored id is uppercased',
      storedPublicId: () => firstPublicId.toUpperCase(),
      requestedPublicId: () => firstPublicId
    }
  ])(
    'matches the single-id resolver when $description and the collation ignores case',
    async ({ storedPublicId, requestedPublicId }) => {
      const caseInsensitiveDatabase = createCaseInsensitiveStatusDatabase(
        storedPublicId(),
        firstStatusUrl
      )
      const param = requestedPublicId()
      const single = await resolveStatusIdParam(caseInsensitiveDatabase, param)
      expect(single).toBe(firstStatusUrl)
      await expect(
        resolveStatusIdParams(caseInsensitiveDatabase, [param])
      ).resolves.toEqual([single])
    }
  )
})

describe('resolveActorIdParams', () => {
  const database = getTestSQLDatabase()
  let actor1PublicId: string
  let actor2PublicId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
    const actor2 = await database.getActorFromId({ id: ACTOR2_ID })
    if (!actor1?.publicId || !actor2?.publicId) {
      throw new Error('seeded actors are missing publicIds')
    }
    actor1PublicId = actor1.publicId
    actor2PublicId = actor2.publicId
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns an empty array without querying the database', async () => {
    const spy = vi.spyOn(database, 'getActorIdsByPublicIds')
    await expect(resolveActorIdParams(database, [])).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('resolves every id form in one array and preserves input order', async () => {
    const unknownPublicId = generatePublicId()
    await expect(
      resolveActorIdParams(database, [
        ACTOR1_ID,
        actor2PublicId,
        urlToId(ACTOR1_ID),
        unknownPublicId
      ])
    ).resolves.toEqual([ACTOR1_ID, ACTOR2_ID, ACTOR1_ID, unknownPublicId])
  })

  it('preserves duplicates and length while looking each publicId up once', async () => {
    const spy = vi.spyOn(database, 'getActorIdsByPublicIds')
    const params = [actor1PublicId, actor2PublicId, actor1PublicId]
    await expect(resolveActorIdParams(database, params)).resolves.toEqual([
      ACTOR1_ID,
      ACTOR2_ID,
      ACTOR1_ID
    ])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      publicIds: [actor1PublicId, actor2PublicId]
    })
    spy.mockRestore()
  })

  it('issues a single lookup no matter how many publicIds are requested', async () => {
    const spy = vi.spyOn(database, 'getActorIdsByPublicIds')
    const params = Array.from({ length: 50 }, () => generatePublicId())
    const resolved = await resolveActorIdParams(database, params)
    expect(resolved).toEqual(params)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('matches the single-id resolver for every element', async () => {
    const params = [
      ACTOR1_ID,
      actor1PublicId,
      urlToId(ACTOR2_ID),
      generatePublicId(),
      actor1PublicId.toUpperCase(),
      ''
    ]
    await expect(resolveActorIdParams(database, params)).resolves.toEqual(
      await Promise.all(
        params.map((param) => resolveActorIdParam(database, param))
      )
    )
  })

  // The stored/requested casings are thunks because the seeded publicIds only
  // exist once beforeAll has run, while the table is built at collection time.
  it.each([
    {
      description: 'the request is uppercased',
      storedPublicId: () => actor1PublicId,
      requestedPublicId: () => actor1PublicId.toUpperCase()
    },
    {
      description: 'the stored id is uppercased',
      storedPublicId: () => actor1PublicId.toUpperCase(),
      requestedPublicId: () => actor1PublicId
    }
  ])(
    'matches the single-id resolver when $description and the collation ignores case',
    async ({ storedPublicId, requestedPublicId }) => {
      const caseInsensitiveDatabase = createCaseInsensitiveActorDatabase(
        storedPublicId(),
        ACTOR1_ID
      )
      const param = requestedPublicId()
      const single = await resolveActorIdParam(caseInsensitiveDatabase, param)
      expect(single).toBe(ACTOR1_ID)
      await expect(
        resolveActorIdParams(caseInsensitiveDatabase, [param])
      ).resolves.toEqual([single])
    }
  )
})

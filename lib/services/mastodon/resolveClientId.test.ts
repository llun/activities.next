import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { resolveActorIdParam, resolveStatusIdParam } from './resolveClientId'

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

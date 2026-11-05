import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  down,
  up
} from '@/migrations/20261105210627_add_media_subject_taxon_rank'

const testDb = createTestDatabase()
beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
})
afterAll(async () => {
  await testDb.destroy()
})

it('adds a nullable text rank without changing existing media, repeat-safe through down/up', async () => {
  const db = testDb.db
  await down(db)
  await down(db)
  const before = await db
    .insertInto('medias')
    .values({ subjectName: 'Bird' })
    .returning('id')
    .executeTakeFirstOrThrow()
  await up(db)
  await up(db)
  expect(
    await db
      .selectFrom('medias')
      .select(['subjectName', 'subjectTaxonRank'])
      .where('id', '=', before.id)
      .executeTakeFirstOrThrow()
  ).toEqual({ subjectName: 'Bird', subjectTaxonRank: null })
  await db
    .updateTable('medias')
    .set({ subjectTaxonRank: 'GENUS' })
    .where('id', '=', before.id)
    .execute()
  await up(db)
  expect(
    (
      await db
        .selectFrom('medias')
        .select('subjectTaxonRank')
        .where('id', '=', before.id)
        .executeTakeFirstOrThrow()
    ).subjectTaxonRank
  ).toBe('GENUS')
  await down(db)
  await up(db)
  expect(
    (
      await db
        .selectFrom('medias')
        .select('subjectTaxonRank')
        .where('id', '=', before.id)
        .executeTakeFirstOrThrow()
    ).subjectTaxonRank
  ).toBeNull()
})

import type { Kysely } from 'kysely'

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const columns = tables.find((table) => table.name === 'medias')?.columns ?? []
  if (!columns.some((column) => column.name === 'subjectTaxonRank')) {
    await db.schema
      .alterTable('medias')
      .addColumn('subjectTaxonRank', 'text')
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  if (
    tables
      .find((table) => table.name === 'medias')
      ?.columns.some((column) => column.name === 'subjectTaxonRank')
  ) {
    await db.schema
      .alterTable('medias')
      .dropColumn('subjectTaxonRank')
      .execute()
  }
}

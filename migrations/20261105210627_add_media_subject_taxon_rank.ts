import type { Kysely } from 'kysely'

// Adds the nullable `medias.subjectTaxonRank` text column: the GBIF rank
// (upper case, e.g. `SPECIES`, `GENUS`) of the taxon the subject lookup
// resolved. The Life list reads it to tell confirmed species from groups and
// unconfirmed subjects. Existing rows start null until a lookup (or the
// backfill's missing-ranks pass) fills them.
//
// Safe to run twice: `up` adds the column only when it is missing, and `down`
// drops it only when it is there.

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

import type { Kysely } from 'kysely'

// Adds the actor's training zone inputs to `fitness_settings`, read from the
// `general` row: `maxHeartRate` and `restingHeartRate` (bpm) and
// `functionalThresholdPower` (W). All nullable; with none set, activities keep
// the default heart-rate zones (lib/fitness/trainingZones.ts). Safe to run
// twice: each column is added only when it is missing.

const COLUMNS = [
  'maxHeartRate',
  'restingHeartRate',
  'functionalThresholdPower'
] as const

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const existing = new Set(
    (
      tables.find((table) => table.name === 'fitness_settings')?.columns ?? []
    ).map((column) => column.name)
  )
  for (const name of COLUMNS) {
    if (existing.has(name)) continue
    await db.schema
      .alterTable('fitness_settings')
      .addColumn(name, 'integer')
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  for (const name of [...COLUMNS].reverse()) {
    await db.schema.alterTable('fitness_settings').dropColumn(name).execute()
  }
}

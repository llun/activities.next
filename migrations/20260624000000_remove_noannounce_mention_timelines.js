/**
 * Removes the materialized "no announces" and "mention" timeline rows.
 *
 * The main timeline page used to expose three tabs (Home / No Announces /
 * Mention) backed by three materialized projections in the `timelines` table.
 * The "No Announces" and "Mention" tabs were removed in favor of the lists
 * feature, so their rows are now dead data: nothing reads `timeline =
 * 'noannounce'` or `timeline = 'mention'` anymore. Delete them to reclaim space.
 *
 * This is a data-only cleanup — it changes no schema, so the reference schema
 * dumps (`migrations/schema.sql`, `migrations/schema.sqlite.sql`) are
 * unaffected. Regeneration was run for both backends per AGENTS.md (129
 * migrations applied each; `knex_migrations` count verified): no DDL delta, so
 * the committed dumps stay in lockstep. The deleted rows are a rebuildable
 * projection of the `statuses` table (reply/mention notifications, which are the
 * surviving signal, live in the separate `notifications` table and are
 * untouched), so `down` is a no-op.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('timelines')
  if (!hasTable) return

  await knex('timelines').whereIn('timeline', ['noannounce', 'mention']).del()
}

/**
 * Irreversible data cleanup: the removed timeline projections can be rebuilt
 * from `statuses` if ever needed, but this migration does not restore them.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
export const down = async function (_knex) {}

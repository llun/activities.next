import { type Kysely, sql } from 'kysely'

// Adds `attachments.isRouteMap`: whether the attachment is the route map a
// fitness job rendered for its status. The map used to be recognised by its
// name, which is also its alt text, so an edit that rewrote the name lost it.
//
// The backfill marks an attachment of a status that has a fitness file when it
// carries the default map name, or when it shows one of that status's
// `fitness_files.mapImagePath` files: as its url's suffix (substr, not LIKE,
// so `%` and `_` in a path are literal), as its media row's `original`, or as
// one of that media's `media_edit_files` (a map re-rendered in the photo
// editor). Safe to run twice: the column is guarded and the update only sets
// rows that are still false.

const ROUTE_MAP_ATTACHMENT_NAME = 'Activity route map'

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const columns =
    tables.find((table) => table.name === 'attachments')?.columns ?? []
  if (!columns.some((column) => column.name === 'isRouteMap')) {
    await db.schema
      .alterTable('attachments')
      .addColumn('isRouteMap', 'boolean', (col) =>
        col.notNull().defaultTo(false)
      )
      .execute()
  }

  await db
    .updateTable('attachments')
    .set({ isRouteMap: true })
    .where('isRouteMap', '=', false)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('fitness_files')
          .select(sql.lit(1).as('one'))
          .whereRef('fitness_files.statusId', '=', 'attachments.statusId')
          .where((inner) =>
            inner.or([
              inner('attachments.name', '=', ROUTE_MAP_ATTACHMENT_NAME),
              inner.and([
                inner('fitness_files.mapImagePath', 'is not', null),
                inner('fitness_files.mapImagePath', '<>', ''),
                inner.or([
                  inner(
                    sql`substr(${sql.ref('attachments.url')}, length(${sql.ref('attachments.url')}) - length(${sql.ref('fitness_files.mapImagePath')}) + 1)`,
                    '=',
                    sql.ref('fitness_files.mapImagePath')
                  ),
                  inner.exists(
                    inner
                      .selectFrom('medias')
                      .select(sql.lit(1).as('one'))
                      .whereRef('medias.id', '=', 'attachments.mediaId')
                      .whereRef(
                        'medias.original',
                        '=',
                        'fitness_files.mapImagePath'
                      )
                  ),
                  inner.exists(
                    inner
                      .selectFrom('media_edit_files')
                      .select(sql.lit(1).as('one'))
                      .whereRef(
                        'media_edit_files.mediaId',
                        '=',
                        'attachments.mediaId'
                      )
                      .whereRef(
                        'media_edit_files.path',
                        '=',
                        'fitness_files.mapImagePath'
                      )
                  )
                ])
              ])
            ])
          )
      )
    )
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.alterTable('attachments').dropColumn('isRouteMap').execute()
}

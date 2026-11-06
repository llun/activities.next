import type {
  AccountExportCursor,
  AccountExportTableName
} from '@/lib/database/domains/accountExport/types'
import { ARRAY_ITEM_MAX_BYTES } from '@/lib/services/accountImport/json/arrayItems'
import {
  ARCHIVE_URI_MAX_LENGTH,
  BOOKMARK_FOLDER_ENTRY_MAX_ITEMS
} from '@/lib/services/accountImport/schemas'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { logger } from '@/lib/utils/logger'

import { MEDIA_ARCHIVE_DIR } from './actorArchive'
import { entryPath } from './layout'
import { groupBy, readAllExportRows } from './rows'
import type { CollectorStep, StepContext } from './steps.types'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const mediaEntry = (context: StepContext, storagePath: string) =>
  entryPath(context.actor.mastodonDir, MEDIA_ARCHIVE_DIR, storagePath)

const stringOrNull = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : null

/** The columns that name coordinates; `stripExactLocations` drops them. */
export const EXACT_LOCATION_COLUMNS = ['placeLatitude', 'placeLongitude']

/**
 * The Fitness privacy settings name coordinates too (the home point and the
 * hidden circles), so `stripExactLocations` drops those, keeping the rest of
 * the row. The raw .fit/.gpx activity files and photo EXIF are the owner's
 * files and are copied as they are.
 */
export const FITNESS_SETTINGS_LOCATION_COLUMNS = [
  'privacyHomeLatitude',
  'privacyHomeLongitude',
  'privacyHideRadiusMeters'
]

export const stripFitnessSettingsLocations = (
  row: Record<string, unknown>
): Record<string, unknown> => {
  const kept = { ...row }
  for (const column of FITNESS_SETTINGS_LOCATION_COLUMNS) delete kept[column]
  kept.privacyLocations = []
  return kept
}

export const stripGallerySettingsLocations = (
  row: Record<string, unknown> | null
): Record<string, unknown> | null =>
  row ? { ...row, hiddenLocations: [] } : row

interface MediasCursor {
  after?: AccountExportCursor | null
}

export const mediasStep: CollectorStep = {
  name: 'medias',
  async run(context, raw) {
    const { database, actor, stage, options } = context
    const cursor = (raw ?? {}) as MediasCursor
    const entry = entryPath(actor.dir, 'medias.jsonl')
    stage.touch(entry)

    const page = await database.getAccountExportRows({
      table: 'medias',
      actorId: actor.id,
      after: cursor.after ?? null,
      limit: context.pageSize
    })

    const editFiles = await database.listMediaEditFiles({
      mediaIds: page.rows.map((row) => String(row.id))
    })
    const editFilesByMedia = groupBy(
      editFiles as unknown as Record<string, unknown>[],
      'mediaId'
    )

    const lines = page.rows.map((row) => {
      const original = stringOrNull(row.original)
      const thumbnail = stringOrNull(row.thumbnail)
      if (original) {
        context.addFile(mediaEntry(context, original), 'media', original)
      }
      if (thumbnail) {
        context.addFile(mediaEntry(context, thumbnail), 'media', thumbnail)
      }
      const edits = (editFilesByMedia.get(String(row.id)) ?? []).map((file) => {
        const filePath = String(file.path)
        context.addFile(mediaEntry(context, filePath), 'media', filePath)
        return {
          id: file.id,
          slot: file.slot,
          bytes: file.bytes,
          mimeType: file.mimeType,
          metaData: file.metaData,
          createdAt: getISOTimeUTC(Number(file.createdAt)),
          archivePath: mediaEntry(context, filePath)
        }
      })

      const line: Record<string, unknown> = {
        ...row,
        archivePath: original ? mediaEntry(context, original) : null,
        thumbnailArchivePath: thumbnail ? mediaEntry(context, thumbnail) : null,
        editFiles: edits
      }
      if (options.stripExactLocations) {
        for (const column of EXACT_LOCATION_COLUMNS) delete line[column]
      }
      return line
    })

    await stage.appendJsonLines(entry, lines)
    context.stats.medias += page.rows.length
    return page.next
      ? { cursor: { after: page.next } satisfies MediasCursor }
      : 'done'
  }
}

interface FitnessCursor {
  after?: { createdAt: number; id: string }
}

export const getFitnessArchiveEntry = (
  context: StepContext,
  file: { id: string; fileType: string }
) =>
  entryPath(
    context.actor.dir,
    'fitness',
    'files',
    `${file.id}.${file.fileType}`
  )

export const fitnessFilesStep: CollectorStep = {
  name: 'fitnessFiles',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? {}) as FitnessCursor
    const entry = entryPath(actor.dir, 'fitness', 'files.jsonl')
    stage.touch(entry)

    const batch = await database.getFitnessFilesByActor({
      actorId: actor.id,
      limit: context.pageSize,
      orderDirection: 'asc',
      ...(cursor.after ? { afterCursor: cursor.after } : null)
    })

    const lines = batch.map((file) => {
      const archivePath = getFitnessArchiveEntry(context, file)
      context.addFile(archivePath, 'fitness', file.path)
      return {
        id: file.id,
        statusId: file.statusId ?? null,
        fileName: file.fileName,
        fileType: file.fileType,
        mimeType: file.mimeType,
        bytes: Number(file.bytes),
        description: file.description ?? null,
        activityType: file.activityType ?? null,
        activityStartTime: file.activityStartTime
          ? getISOTimeUTC(file.activityStartTime)
          : null,
        totalDistanceMeters: file.totalDistanceMeters ?? null,
        totalDurationSeconds: file.totalDurationSeconds ?? null,
        movingTimeSeconds: file.movingTimeSeconds ?? null,
        elevationGainMeters: file.elevationGainMeters ?? null,
        deviceManufacturer: file.deviceManufacturer ?? null,
        deviceName: file.deviceName ?? null,
        sourceUrl: file.sourceUrl ?? null,
        gearId: file.gearId ?? null,
        deviceGearId: file.deviceGearId ?? null,
        isPrimary: file.isPrimary ?? null,
        importBatchId: file.importBatchId ?? null,
        createdAt: getISOTimeUTC(file.createdAt),
        archivePath
      }
    })
    await stage.appendJsonLines(entry, lines)
    context.stats.fitnessFiles += batch.length

    if (batch.length < context.pageSize) return 'done'
    const last = batch[batch.length - 1]
    return {
      cursor: {
        after: { createdAt: Number(last.createdAt), id: last.id }
      } satisfies FitnessCursor
    }
  }
}

export const fitnessMetaStep: CollectorStep = {
  name: 'fitnessMeta',
  async run(context) {
    const { database, actor, stage, pageSize } = context
    const [gears, components, periods, settings] = await Promise.all([
      readAllExportRows(database, 'fitness_gears', actor.id, pageSize),
      readAllExportRows(
        database,
        'fitness_gear_components',
        actor.id,
        pageSize
      ),
      readAllExportRows(
        database,
        'fitness_gear_component_periods',
        actor.id,
        pageSize
      ),
      readAllExportRows(database, 'fitness_settings', actor.id, pageSize)
    ])
    const periodsByComponent = groupBy(periods, 'componentId')
    const componentsByGear = groupBy(
      components.map((component) => ({
        ...component,
        periods: periodsByComponent.get(String(component.id)) ?? []
      })),
      'gearId'
    )
    await stage.append(
      entryPath(actor.dir, 'fitness', 'gears.json'),
      json(
        gears.map((gear) => ({
          ...gear,
          components: componentsByGear.get(String(gear.id)) ?? []
        }))
      )
    )
    await stage.append(
      entryPath(actor.dir, 'fitness', 'settings.json'),
      json(
        context.options.stripExactLocations
          ? settings.map(stripFitnessSettingsLocations)
          : settings
      )
    )
    return 'done'
  }
}

export const galleryStep: CollectorStep = {
  name: 'gallery',
  async run(context) {
    const { database, actor, stage, pageSize } = context
    const [albums, items, gears, settings] = await Promise.all([
      readAllExportRows(database, 'gallery_albums', actor.id, pageSize),
      readAllExportRows(database, 'gallery_album_items', actor.id, pageSize),
      readAllExportRows(database, 'gallery_gears', actor.id, pageSize),
      readAllExportRows(database, 'gallery_settings', actor.id, pageSize)
    ])
    const itemsByAlbum = groupBy(items, 'albumId')
    await stage.append(
      entryPath(actor.dir, 'gallery', 'albums.json'),
      json(
        albums.map((album) => ({
          ...album,
          items: (itemsByAlbum.get(String(album.id)) ?? []).map((item) => ({
            mediaId: item.mediaId,
            createdAt: item.createdAt
          }))
        }))
      )
    )
    await stage.append(
      entryPath(actor.dir, 'gallery', 'gears.json'),
      json(gears)
    )
    await stage.append(
      entryPath(actor.dir, 'gallery', 'settings.json'),
      json(
        context.options.stripExactLocations
          ? stripGallerySettingsLocations(settings[0] ?? null)
          : (settings[0] ?? null)
      )
    )
    return 'done'
  }
}

// The importer reads `bookmark_folders.json` one array entry at a time and
// refuses an entry over `ARRAY_ITEM_MAX_BYTES`, so an entry is kept to half
// of that, by its pretty-printed bytes (URIs vary in length), and to the
// schema's item cap.
export const BOOKMARK_FOLDER_ENTRY_MAX_BYTES = ARRAY_ITEM_MAX_BYTES / 2
// Inside the document's array, each URI is on its own line, indented six
// spaces, after a comma.
const ITEM_OVERHEAD_BYTES = 8

/**
 * One folder as one entry or more, each within the import's limits. A URI
 * longer than the import accepts would fail its whole entry, so it is left
 * out and counted in `omitted`.
 */
export const splitBookmarkFolder = (
  folder: Record<string, unknown>,
  allUris: string[]
): { entries: Record<string, unknown>[]; omitted: number } => {
  const uris = allUris.filter((uri) => uri.length <= ARCHIVE_URI_MAX_LENGTH)
  // The entry as it sits inside the document's array (one level deeper), with
  // a few bytes for the items' closing bracket on its own line.
  const baseBytes =
    Buffer.byteLength(JSON.stringify([{ ...folder, items: [] }], null, 2)) + 8
  const entries: Record<string, unknown>[] = []
  let current: string[] = []
  let bytes = baseBytes
  for (const uri of uris) {
    const itemBytes =
      Buffer.byteLength(JSON.stringify(uri)) + ITEM_OVERHEAD_BYTES
    if (
      current.length > 0 &&
      (bytes + itemBytes > BOOKMARK_FOLDER_ENTRY_MAX_BYTES ||
        current.length >= BOOKMARK_FOLDER_ENTRY_MAX_ITEMS)
    ) {
      entries.push({ ...folder, items: current })
      current = []
      bytes = baseBytes
    }
    current.push(uri)
    bytes += itemBytes
  }
  entries.push({ ...folder, items: current })
  return { entries, omitted: allUris.length - uris.length }
}

// The owner's private bookmark folders, each with the status URIs filed in
// it; a large folder is several entries of the same name. The bookmarks themselves stay in the Mastodon `bookmarks.json`, so a
// Mastodon importer reads them as before and an archive without this file
// imports every bookmark unfiled.
export const bookmarkFoldersStep: CollectorStep = {
  name: 'bookmarkFolders',
  async run(context) {
    const { database, actor, stage, pageSize } = context
    const [folders, items] = await Promise.all([
      readAllExportRows(database, 'bookmark_folders', actor.id, pageSize),
      readAllExportRows(database, 'bookmark_folder_items', actor.id, pageSize)
    ])
    const itemsByFolder = groupBy(items, 'folderId')
    let omitted = 0
    const entries = folders.flatMap((folder) => {
      const split = splitBookmarkFolder(
        folder,
        (itemsByFolder.get(String(folder.id)) ?? []).map((item) =>
          String(item.statusId)
        )
      )
      omitted += split.omitted
      return split.entries
    })
    if (omitted > 0) {
      // A count only: the URIs (and the folders) are the owner's private data.
      context.warn(
        omitted === 1
          ? "1 bookmark couldn't be filed in its folder in bookmark_folders.json because its address is too long to import. It is still in bookmarks.json."
          : `${omitted} bookmarks couldn't be filed in their folders in bookmark_folders.json because their address is too long to import. They are still in bookmarks.json.`
      )
      logger.warn({
        message:
          'Left bookmark folder URIs too long to import out of an archive',
        actorId: actor.id,
        omitted
      })
    }
    await stage.append(
      entryPath(actor.dir, 'bookmark_folders.json'),
      json(entries)
    )
    return 'done'
  }
}

export const scheduledStep: CollectorStep = {
  name: 'scheduled',
  async run(context) {
    const rows = await readAllExportRows(
      context.database,
      'scheduled_statuses',
      context.actor.id,
      context.pageSize
    )
    await context.stage.append(
      entryPath(context.actor.dir, 'scheduled.json'),
      json(rows)
    )
    return 'done'
  }
}

const REACTION_TABLES = [
  ['status_reactions', 'reaction'],
  ['poll_answers', 'pollVote']
] as const satisfies readonly (readonly [AccountExportTableName, string])[]

interface ReactionsCursor {
  table: number
  after?: AccountExportCursor | null
}

/** Emoji reactions the actor gave and the poll votes it cast on any status. */
export const reactionsStep: CollectorStep = {
  name: 'reactions',
  async run(context, raw) {
    const cursor = (raw ?? { table: 0 }) as ReactionsCursor
    const entry = entryPath(context.actor.dir, 'reactions.jsonl')
    context.stage.touch(entry)

    const [table, kind] = REACTION_TABLES[cursor.table]
    const page = await context.database.getAccountExportRows({
      table,
      actorId: context.actor.id,
      after: cursor.after ?? null,
      limit: context.pageSize
    })
    await context.stage.appendJsonLines(
      entry,
      page.rows.map((row) => ({ kind, ...row }))
    )

    if (page.next) return { cursor: { table: cursor.table, after: page.next } }
    if (cursor.table + 1 < REACTION_TABLES.length) {
      return { cursor: { table: cursor.table + 1, after: null } }
    }
    return 'done'
  }
}

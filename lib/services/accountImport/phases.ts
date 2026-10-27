import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'

import { getQuoteTargetId } from '@/lib/activities/note'
import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import type { UpdateActorParams } from '@/lib/database/domains/actor/types'
import type { Database } from '@/lib/database/types'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  ACCOUNT_IMPORT_CATALOG_PAGE_SIZE,
  ACCOUNT_IMPORT_ITEM_PAGE_SIZE,
  ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS,
  ACCOUNT_IMPORT_MAX_ITEMS
} from '@/lib/services/accountImport/constants'
import { createImportedStatus } from '@/lib/services/accountImport/createImportedStatus'
import { detectArchiveKind } from '@/lib/services/accountImport/detectArchiveKind'
import { iterateArrayItems } from '@/lib/services/accountImport/json/arrayItems'
import { iterateJsonlLines } from '@/lib/services/accountImport/json/jsonl'
import { iterateOrderedItems } from '@/lib/services/accountImport/json/orderedItems'
import { readTopLevelJsonFields } from '@/lib/services/accountImport/json/topLevelJsonFields'
import { readTopLevelStringFields } from '@/lib/services/accountImport/json/topLevelStringFields'
import { mapMastodonItem } from '@/lib/services/accountImport/mappers/mapMastodonItem'
import { mapOwnStatus } from '@/lib/services/accountImport/mappers/mapOwnStatus'
import type { ImportedStatusInput } from '@/lib/services/accountImport/mappers/types'
import { AccountImportArchiveChangedError } from '@/lib/services/accountImport/objectStore'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  type AccountImportProgress,
  type ArchiveStatusOrder,
  type CatalogStage,
  parseImportCursor,
  serializeImportCursor,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import {
  mastodonActivitySchema,
  mastodonActorSchema,
  ownAlbumSchema,
  ownFitnessFileLineSchema,
  ownFitnessGearSchema,
  ownGalleryGearSchema,
  ownMediaLineSchema,
  ownStatusRecordSchema
} from '@/lib/services/accountImport/schemas'
import {
  type ZipArchive,
  ZipArchiveError,
  type ZipCatalogEntry,
  openZipArchive
} from '@/lib/services/accountImport/zip/reader'
import { normalizeProfileFieldRows } from '@/lib/services/accounts/profileFields'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { hasFederatedProfileChange } from '@/lib/services/actors/hasFederatedProfileChange'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import {
  FITNESS_GEAR_KINDS,
  type FitnessGearKind
} from '@/lib/services/fitness-files/sportTypes'
import { FitnessFileUploadSchema } from '@/lib/services/fitness-files/types'
import { UpdateGallerySettingsRequest } from '@/lib/services/gallery/galleryRequests'
import { importRow } from '@/lib/services/imports/importRow'
import { deleteMediaFile, saveMedia } from '@/lib/services/medias'
import {
  ACCEPTED_FILE_TYPES,
  ACCEPTED_IMAGE_TYPES
} from '@/lib/services/medias/constants'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { sanitizeStoredFileName } from '@/lib/services/medias/fileName'
import { readValidThumbnail } from '@/lib/services/medias/thumbnailInput'
import { MediaSchema } from '@/lib/services/medias/types'
import { getQueue } from '@/lib/services/queue'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import {
  GALLERY_GEAR_KINDS,
  type GalleryGearKind
} from '@/lib/types/database/gallery'
import {
  GALLERY_ALBUM_SORTS,
  MAX_GALLERY_ALBUMS_PER_ACTOR,
  MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH,
  MAX_GALLERY_ALBUM_ITEMS,
  MAX_GALLERY_ALBUM_TITLE_LENGTH
} from '@/lib/types/database/galleryAlbums'
import { NotificationPolicyValue } from '@/lib/types/database/operations'
import { POST_LINE_LIMIT_VALUES } from '@/lib/types/database/rows'
import type {
  AccountImport,
  AccountImportItem
} from '@/lib/types/domain/accountImport'
import type { Actor } from '@/lib/types/domain/actor'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  StreamByteLimitError,
  readAsyncIterableToBufferWithLimit
} from '@/lib/utils/streamLimit'

export type AccountArchiveKind = 'mastodon' | 'activities.next'
export type PhaseResult = 'done' | 'budget' | 'cancelled'

export interface AccountImportPhaseContext {
  database: Database
  objectStore: AccountImportObjectStore
  accountImport: AccountImport
  now: () => number
  deadline: number
  renew: () => Promise<void>
}

export interface InspectedArchive {
  kind: AccountArchiveKind
  sourceActorId: string
  sourceFollowersUrl: string | null
}

export const accountImportOptionsSchema = z
  .object({
    likes: z.boolean().default(false),
    bookmarks: z.boolean().default(false),
    repliesToOthers: z.enum(['skip', 'keep']).default('skip'),
    profile: z.boolean().default(false),
    settings: z.boolean().default(false)
  })
  .strip()

export type AccountImportOptions = z.infer<typeof accountImportOptionsSchema>

const selectedOptions = (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress
): AccountImportOptions =>
  progress.selectedOptions ??
  parseAccountImportOptions(context.accountImport.options)

export const parseAccountImportOptions = (
  value: string
): AccountImportOptions => {
  try {
    const parsed: unknown = JSON.parse(value)
    return accountImportOptionsSchema.parse(parsed)
  } catch {
    return accountImportOptionsSchema.parse({})
  }
}

const openArchive = async (
  objectStore: AccountImportObjectStore,
  accountImport: AccountImport
): Promise<ZipArchive> => {
  const source = await objectStore.openSource(accountImport)
  if (!source) throw new ZipArchiveError('not_a_zip', 'archive_missing')
  return openZipArchive(source)
}

const chunksOf = (stream: Readable) => stream as AsyncIterable<Buffer>

const requiredEntry = (entries: readonly ZipCatalogEntry[], name: string) =>
  entries.some((entry) => entry.name === name)

/** Resolve the default actor's extras directory without reading profiles whole. */
const getOwnArchiveExtrasDir = async (
  archive: ZipArchive,
  sourceActorId: string
): Promise<string | null> => {
  for (const entry of archive.entries) {
    if (
      !entry.name.startsWith('activities.next/actors/') ||
      !entry.name.endsWith('/profile.json')
    ) {
      continue
    }
    const fields = await readTopLevelJsonFields(
      chunksOf(await archive.openEntryStream(entry.name)),
      ['id', 'isDefault']
    )
    if (fields.id === sourceActorId && fields.isDefault === true) {
      return entry.name.slice(0, -'/profile.json'.length)
    }
  }
  return null
}

const resolveOwnArchiveExtrasDir = async (
  archive: ZipArchive,
  progress: AccountImportProgress,
  kind: AccountArchiveKind
) => {
  if (progress.sourceExtrasDir === undefined) {
    progress.sourceExtrasDir =
      kind === 'activities.next'
        ? await getOwnArchiveExtrasDir(archive, progress.sourceActorId ?? '')
        : null
  }
  return progress.sourceExtrasDir
}

type CatalogItemKind =
  | 'status'
  | 'media'
  | 'own-media'
  | 'like'
  | 'bookmark'
  | 'gallery-settings'
  | 'gallery-gear'
  | 'fitness-gear'
  | 'album'
  | 'fitness-file'

export const getAccountImportItemPosition = (
  kind: CatalogItemKind,
  index: number,
  maxItems: number,
  options: { order?: ArchiveStatusOrder; attachmentIndex?: number } = {}
): number => {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    index >= maxItems
  ) {
    throw new ZipArchiveError('too_many_entries', 'catalog_item_limit_exceeded')
  }
  const mediaStart = maxItems + 1
  const ownMediaStart = maxItems * 41 + 1
  const likeStart = maxItems * 42 + 1
  const bookmarkStart = maxItems * 43 + 1
  const settingsStart = maxItems * 44 + 1
  const galleryGearStart = settingsStart + 1
  const fitnessGearStart = maxItems * 45 + 2
  const albumStart = maxItems * 46 + 2
  const fitnessFileStart = maxItems * 47 + 2
  switch (kind) {
    case 'status':
      return options.order === 'oldest-first' ? index + 1 : maxItems - index
    case 'media': {
      const attachmentIndex = options.attachmentIndex ?? 0
      if (
        !Number.isSafeInteger(attachmentIndex) ||
        attachmentIndex < 0 ||
        attachmentIndex >= ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS
      ) {
        throw new ZipArchiveError(
          'too_many_entries',
          'catalog_item_limit_exceeded'
        )
      }
      return (
        mediaStart +
        index * ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS +
        attachmentIndex
      )
    }
    case 'own-media':
      return ownMediaStart + index
    case 'like':
      return likeStart + index
    case 'bookmark':
      return bookmarkStart + index
    case 'gallery-settings':
      return settingsStart
    case 'gallery-gear':
      return galleryGearStart + index
    case 'fitness-gear':
      return fitnessGearStart + index
    case 'album':
      return albumStart + index
    case 'fitness-file':
      return fitnessFileStart + index
  }
}

const getActorEntryName = (kind: AccountArchiveKind) =>
  kind === 'activities.next' ? 'actor.json' : 'actor.json'

/** Inspects only bounded root fields; it never parses the actor entry as a whole. */
export const inspectAccountArchive = async (
  context: Pick<AccountImportPhaseContext, 'objectStore' | 'accountImport'>
): Promise<InspectedArchive | null> => {
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const kind = detectArchiveKind([...archive.entries])
    if (kind === 'unrecognised') return null
    const actorName = getActorEntryName(kind)
    if (!requiredEntry(archive.entries, actorName)) return null
    const fields = await readTopLevelStringFields(
      chunksOf(await archive.openEntryStream(actorName)),
      ['id', 'followers', 'preferredUsername']
    )
    const actor = mastodonActorSchema.safeParse(fields)
    if (!actor.success) return null
    return {
      kind,
      sourceActorId: actor.data.id,
      sourceFollowersUrl: actor.data.followers ?? null
    }
  } finally {
    await archive.close()
  }
}

const getEventPublishedAt = (raw: string, kind: AccountArchiveKind) => {
  try {
    const value: unknown = JSON.parse(raw)
    if (kind === 'activities.next') {
      const parsed = ownStatusRecordSchema.safeParse(value)
      return parsed.success ? Date.parse(parsed.data.createdAt) : Number.NaN
    }
    const parsed = mastodonActivitySchema.safeParse(value)
    if (!parsed.success || parsed.data.type !== 'Create') return Number.NaN
    return Date.parse(
      parsed.data.object.published ?? parsed.data.published ?? ''
    )
  } catch {
    return Number.NaN
  }
}

const inferStatusOrder = async (
  archive: ZipArchive,
  kind: AccountArchiveKind,
  sourceExtrasDir: string | null
): Promise<ArchiveStatusOrder> => {
  const name =
    kind === 'mastodon'
      ? 'outbox.json'
      : sourceExtrasDir
        ? `${sourceExtrasDir}/statuses.jsonl`
        : ''
  if (!requiredEntry(archive.entries, name)) return 'newest-first'
  const dates: number[] = []
  const stream = await archive.openEntryStream(name)
  const events =
    kind === 'mastodon'
      ? iterateOrderedItems(chunksOf(stream))
      : iterateJsonlLines(chunksOf(stream))
  for await (const event of events) {
    if (!('raw' in event)) continue
    const published = getEventPublishedAt(event.raw, kind)
    if (!Number.isFinite(published)) continue
    dates.push(published)
    if (dates.length === 2) break
  }
  return dates.length === 2 && dates[0] <= dates[1]
    ? 'oldest-first'
    : 'newest-first'
}

export const mediaArchivePathFromUrl = (sourceUrl: string): string | null => {
  let pathname = sourceUrl
  try {
    if (URL.canParse(sourceUrl)) pathname = new URL(sourceUrl).pathname
  } catch {
    return null
  }
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // The undecoded text is still treated as a relative archive name below.
  }
  const normalized = pathname.replace(/\\/g, '/')
  const marker = 'media_attachments/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return null
  const candidate = normalized.slice(markerIndex)
  if (
    candidate.includes('\0') ||
    candidate.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    return null
  }
  return candidate
}

const sourceIdForStatus = (
  value: unknown,
  kind: AccountArchiveKind,
  index: number
) => {
  if (kind === 'activities.next') {
    const parsed = ownStatusRecordSchema.safeParse(value)
    return parsed.success && parsed.data.id.length <= 512
      ? parsed.data.id
      : `archive-entry:${index}`
  }
  const parsed = mastodonActivitySchema.safeParse(value)
  if (!parsed.success) return `archive-entry:${index}`
  const id =
    parsed.data.type === 'Create' ? parsed.data.object.id : parsed.data.id
  return id.length <= 512 ? id : `archive-entry:${index}`
}

const statusAttachments = (value: unknown, kind: AccountArchiveKind) => {
  if (kind === 'activities.next') {
    const parsed = ownStatusRecordSchema.safeParse(value)
    return parsed.success && parsed.data.type !== 'Announce'
      ? parsed.data.attachments
      : []
  }
  const parsed = mastodonActivitySchema.safeParse(value)
  if (!parsed.success || parsed.data.type !== 'Create') return []
  const attachments = parsed.data.object.attachment
  return attachments === undefined
    ? []
    : Array.isArray(attachments)
      ? attachments
      : [attachments]
}

const sourceIdForAttachment = (attachment: { url: string }) =>
  mediaArchivePathFromUrl(attachment.url)

const parseJsonItem = (raw: string): unknown => JSON.parse(raw)

const gallerySettingsFields = [
  'autoDescribe',
  'allowEmptyDescription',
  'subjectHashtags',
  'galleryDefault',
  'defaultPlacePrecision',
  'showGear',
  'mapPublic',
  'lifeListPublic',
  'hiddenLocations',
  'hideThreatenedPlaces',
  'subjectSuggestionMode',
  'subjectConfidenceThreshold',
  'photoEnhance',
  'createdAt',
  'updatedAt'
] as const

const listEventStream = async (
  archive: ZipArchive,
  kind: AccountArchiveKind,
  stage: Exclude<CatalogStage, 'done'>,
  sourceExtrasDir: string | null
) => {
  if (stage === 'statuses') {
    const name =
      kind === 'mastodon'
        ? 'outbox.json'
        : sourceExtrasDir
          ? `${sourceExtrasDir}/statuses.jsonl`
          : ''
    if (!requiredEntry(archive.entries, name)) return null
    return kind === 'mastodon'
      ? iterateOrderedItems(chunksOf(await archive.openEntryStream(name)))
      : iterateJsonlLines(chunksOf(await archive.openEntryStream(name)))
  }
  if (stage === 'likes' || stage === 'bookmarks') {
    const name = stage === 'likes' ? 'likes.json' : 'bookmarks.json'
    if (!requiredEntry(archive.entries, name)) return null
    return iterateOrderedItems(chunksOf(await archive.openEntryStream(name)))
  }
  if (kind !== 'activities.next') return null
  if (!sourceExtrasDir) return null
  if (stage === 'ownMedia' || stage === 'fitnessFiles') {
    const name =
      stage === 'ownMedia'
        ? `${sourceExtrasDir}/medias.jsonl`
        : `${sourceExtrasDir}/fitness/files.jsonl`
    if (!requiredEntry(archive.entries, name)) return null
    return iterateJsonlLines(chunksOf(await archive.openEntryStream(name)))
  }
  const name =
    stage === 'galleryGears'
      ? `${sourceExtrasDir}/gallery/gears.json`
      : stage === 'fitnessGears'
        ? `${sourceExtrasDir}/fitness/gears.json`
        : `${sourceExtrasDir}/gallery/albums.json`
  if (!requiredEntry(archive.entries, name)) return null
  return iterateArrayItems(chunksOf(await archive.openEntryStream(name)))
}

export const runCatalogPhase = async (
  context: AccountImportPhaseContext,
  progressInput: AccountImportProgress,
  maxItems = ACCOUNT_IMPORT_MAX_ITEMS
): Promise<{
  result: PhaseResult
  progress: AccountImportProgress
  cursor: string | null
}> => {
  const progress = { ...progressInput }
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
    throw new RangeError('maxItems must be a positive safe integer')
  }
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const kind = context.accountImport.kind as AccountArchiveKind
    const sourceExtrasDir = await resolveOwnArchiveExtrasDir(
      archive,
      progress,
      kind
    )
    if (progress.totalItems > maxItems) {
      throw new ZipArchiveError(
        'too_many_entries',
        'catalog_item_limit_exceeded'
      )
    }
    if (
      progress.statusOrder !== 'oldest-first' &&
      progress.catalogIndex === 0
    ) {
      progress.statusOrder = await inferStatusOrder(
        archive,
        kind,
        sourceExtrasDir
      )
    }
    while (progress.catalogStage !== 'done') {
      const stage = progress.catalogStage
      const events = await listEventStream(
        archive,
        kind,
        stage,
        sourceExtrasDir ?? null
      )
      if (!events) {
        progress.catalogStage = nextCatalogStage(stage)
        progress.catalogIndex = 0
        await context.renew()
        await context.database.updateAccountImport({
          id: context.accountImport.id,
          progress: serializeImportProgress(progress),
          cursor: null
        })
        continue
      }
      const items: {
        kind: string
        sourceId: string
        position: number
        data?: string
      }[] = []
      let nextIndex = progress.catalogIndex
      const flushCatalogPage = async (cursorIndex: number) => {
        if (items.length === 0) return false
        await context.renew()
        await context.database.upsertAccountImportItems({
          importId: context.accountImport.id,
          actorId: context.accountImport.actorId,
          items
        })
        progress.totalItems += items.length
        items.length = 0
        progress.catalogIndex = cursorIndex
        await context.renew()
        await context.database.updateAccountImport({
          id: context.accountImport.id,
          progress: serializeImportProgress(progress),
          cursor: JSON.stringify({ stage, index: cursorIndex })
        })
        return context.now() >= context.deadline
      }
      const addItem = (item: (typeof items)[number]) => {
        if (progress.totalItems + items.length >= maxItems) {
          throw new ZipArchiveError(
            'too_many_entries',
            'catalog_item_limit_exceeded'
          )
        }
        items.push(item)
      }
      for await (const event of events) {
        if (event.index < progress.catalogIndex) continue
        if (event.index >= maxItems) {
          throw new ZipArchiveError(
            'too_many_entries',
            'catalog_item_limit_exceeded'
          )
        }
        const eventItemLimit = stage === 'statuses' ? 1 + 40 : 1
        if (
          items.length > 0 &&
          items.length + eventItemLimit > ACCOUNT_IMPORT_CATALOG_PAGE_SIZE
        ) {
          if (await flushCatalogPage(event.index)) {
            return {
              result: 'budget',
              progress,
              cursor: JSON.stringify({ stage, index: event.index })
            }
          }
        }
        nextIndex = event.index + 1
        if ('raw' in event) {
          let value: unknown
          try {
            value = parseJsonItem(event.raw)
          } catch {
            value = null
          }
          if (stage === 'statuses' && value !== null) {
            addItem({
              kind: 'status',
              sourceId: sourceIdForStatus(value, kind, event.index),
              position: getAccountImportItemPosition(
                'status',
                event.index,
                maxItems,
                { order: progress.statusOrder }
              ),
              data: event.raw
            })
            for (const [attachmentIndex, attachment] of (kind === 'mastodon'
              ? statusAttachments(value, kind).slice(
                  0,
                  ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS
                )
              : []
            ).entries()) {
              const sourceId = sourceIdForAttachment(attachment)
              if (sourceId) {
                addItem({
                  kind: 'media',
                  sourceId,
                  position: getAccountImportItemPosition(
                    'media',
                    event.index,
                    maxItems,
                    { attachmentIndex }
                  )
                })
              }
            }
          } else if (
            (stage === 'likes' || stage === 'bookmarks') &&
            typeof value === 'string' &&
            value.length <= 512
          ) {
            addItem({
              kind: stage === 'likes' ? 'like' : 'bookmark',
              sourceId: value,
              position: getAccountImportItemPosition(
                stage === 'likes' ? 'like' : 'bookmark',
                event.index,
                maxItems
              ),
              data: event.raw
            })
          } else if (stage === 'ownMedia') {
            const parsed = ownMediaLineSchema.safeParse(
              normalizeOwnMediaRecord(value)
            )
            if (parsed.success) {
              addItem({
                kind: 'own-media',
                sourceId: String(parsed.data.id),
                position: getAccountImportItemPosition(
                  'own-media',
                  event.index,
                  maxItems
                ),
                data: JSON.stringify(parsed.data)
              })
            }
          } else if (stage === 'galleryGears') {
            const parsed = ownGalleryGearSchema.safeParse(value)
            if (parsed.success) {
              addItem({
                kind: 'gallery-gear',
                sourceId: parsed.data.id,
                position: getAccountImportItemPosition(
                  'gallery-gear',
                  event.index,
                  maxItems
                ),
                data: event.raw
              })
            }
          } else if (stage === 'fitnessGears') {
            const parsed = ownFitnessGearSchema.safeParse(value)
            if (parsed.success) {
              addItem({
                kind: 'fitness-gear',
                sourceId: parsed.data.id,
                position: getAccountImportItemPosition(
                  'fitness-gear',
                  event.index,
                  maxItems
                ),
                data: event.raw
              })
            }
          } else if (stage === 'albums') {
            const parsed = ownAlbumSchema.safeParse(value)
            if (parsed.success) {
              addItem({
                kind: 'album',
                sourceId: parsed.data.id,
                position: getAccountImportItemPosition(
                  'album',
                  event.index,
                  maxItems
                ),
                data: event.raw
              })
            }
          } else if (stage === 'fitnessFiles') {
            const parsed = ownFitnessFileLineSchema.safeParse(value)
            if (parsed.success) {
              addItem({
                kind: 'fitness-file',
                sourceId: parsed.data.id,
                position: getAccountImportItemPosition(
                  'fitness-file',
                  event.index,
                  maxItems
                ),
                data: event.raw
              })
            }
          }
        }
        if (items.length >= ACCOUNT_IMPORT_CATALOG_PAGE_SIZE) {
          if (await flushCatalogPage(nextIndex))
            return {
              result: 'budget',
              progress,
              cursor: JSON.stringify({ stage, index: nextIndex })
            }
        }
      }
      if (items.length > 0) {
        await flushCatalogPage(nextIndex)
      }
      progress.catalogStage = nextCatalogStage(stage)
      progress.catalogIndex = 0
      await context.renew()
      await context.database.updateAccountImport({
        id: context.accountImport.id,
        progress: serializeImportProgress(progress),
        cursor: null
      })
      if (
        context.now() >= context.deadline &&
        progress.catalogStage !== 'done'
      ) {
        return {
          result: 'budget',
          progress,
          cursor: JSON.stringify({ stage: progress.catalogStage, index: 0 })
        }
      }
    }
    return { result: 'done', progress, cursor: null }
  } finally {
    await archive.close()
  }
}

const nextCatalogStage = (
  stage: Exclude<CatalogStage, 'done'>
): CatalogStage => {
  const stages: CatalogStage[] = [
    'statuses',
    'likes',
    'bookmarks',
    'ownMedia',
    'galleryGears',
    'fitnessGears',
    'albums',
    'fitnessFiles',
    'done'
  ]
  return stages[stages.indexOf(stage) + 1]
}

const parseCatalogedItem = (data: string | null): unknown => {
  if (data === null) return null
  try {
    return parseJsonItem(data)
  } catch {
    return null
  }
}

const normalizeOwnMediaRecord = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.subjectTaxonPath !== 'string') return value
  try {
    return {
      ...record,
      subjectTaxonPath: JSON.parse(record.subjectTaxonPath) as unknown
    }
  } catch {
    return value
  }
}

const itemReferences = async (
  context: AccountImportPhaseContext,
  kinds: string[],
  sourceIds: Iterable<string>
) =>
  context.database.getAccountImportItemReferences({
    actorId: context.accountImport.actorId,
    kinds,
    sourceIds: [...new Set(sourceIds)]
  })

const targetMapForKind = (
  references: Awaited<ReturnType<typeof itemReferences>>,
  kind: string
) =>
  new Map(
    references
      .filter(
        (reference) =>
          reference.kind === kind &&
          reference.state === 'done' &&
          reference.targetId !== null
      )
      .map((reference) => [reference.sourceId, reference.targetId as string])
  )

const collectStatusReferenceIds = (
  value: unknown,
  kind: AccountArchiveKind
): { statusIds: string[]; mediaIds: string[] } => {
  const statusIds: string[] = []
  const mediaIds: string[] = []
  if (kind === 'activities.next') {
    const parsed = ownStatusRecordSchema.safeParse(value)
    if (parsed.success && parsed.data.type !== 'Announce') {
      if (parsed.data.inReplyTo) statusIds.push(parsed.data.inReplyTo)
      if (parsed.data.quote) statusIds.push(parsed.data.quote.quotedStatusId)
    }
  } else {
    const parsed = mastodonActivitySchema.safeParse(value)
    if (parsed.success && parsed.data.type === 'Create') {
      const note = parsed.data.object
      const inReplyTo = note.inReplyTo
      if (typeof inReplyTo === 'string') statusIds.push(inReplyTo)
      else if (inReplyTo?.id) statusIds.push(inReplyTo.id)
      const quoteTarget = getQuoteTargetId(note as never)
      if (quoteTarget) statusIds.push(quoteTarget)
    }
  }
  for (const attachment of statusAttachments(value, kind)) {
    const archivePath = sourceIdForAttachment(attachment)
    if (archivePath) mediaIds.push(archivePath)
    if ('mediaId' in attachment && attachment.mediaId) {
      mediaIds.push(String(attachment.mediaId))
    }
  }
  return { statusIds, mediaIds }
}

const statusInputWithTargetReferences = (
  input: ImportedStatusInput,
  mediaByArchivePath: Map<string, string>,
  targetBySourceId: Map<string, string>
): ImportedStatusInput => ({
  ...input,
  replyToStatusId: input.replyToStatusId
    ? (targetBySourceId.get(input.replyToStatusId) ?? null)
    : null,
  quoteSourceId: input.quoteSourceId
    ? (targetBySourceId.get(input.quoteSourceId) ?? null)
    : null,
  quoteStatusId: input.quoteStatusId
    ? (targetBySourceId.get(input.quoteStatusId) ?? null)
    : null,
  attachments: input.attachments.map((attachment) => ({
    ...attachment,
    mediaId:
      mediaByArchivePath.get(
        mediaArchivePathFromUrl(attachment.sourceUrl) ?? ''
      ) ??
      (attachment.mediaId
        ? (mediaByArchivePath.get(attachment.mediaId) ?? null)
        : null)
  }))
})

const terminalItemState = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem,
  state: 'done' | 'skipped' | 'failed',
  reason?: string,
  targetId?: string | null
) => {
  await context.renew()
  const marked = await context.database.markAccountImportItem({
    id: item.id,
    state,
    ...(state === 'failed' ? { retryable: true } : {}),
    ...(reason ? { reason } : {}),
    ...(targetId !== undefined ? { targetId } : {})
  })
  if (!marked) throw new Error('import_item_missing')
  if (state === 'done') progress.completedItems += 1
  else if (state === 'skipped') progress.skippedItems += 1
  await context.renew()
  await context.database.updateAccountImport({
    id: context.accountImport.id,
    progress: serializeImportProgress(progress),
    cursor: serializeImportCursor(item.position)
  })
}

// One item's own database error must not fail the whole import: the item is
// marked failed with a fixed reason code (never the exception text) and the
// phase moves on to the next item. A lost lease or a cancellation still stops
// the phase, because the renew inside rethrows those.
const handleItemError = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem,
  error: unknown
) => {
  // A changed archive is terminal for the whole import, not a verdict about
  // one item: it must reach the runner, never become a skip or a failed row.
  if (error instanceof AccountImportArchiveChangedError) throw error
  await context.renew()
  await terminalItemState(context, progress, item, 'failed', 'item_failed')
  logger.error({
    message: 'Account import item failed',
    importId: context.accountImport.id,
    itemKind: item.kind,
    err: toArchiveLoggableError(error)
  })
}

// Every database write in the item phases runs with the lease in hand: the
// renew happens immediately before the write, so a run that has lost its
// lease writes nothing.
const leasedWrite = async <T>(
  context: AccountImportPhaseContext,
  write: () => Promise<T>
): Promise<T> => {
  await context.renew()
  return write()
}

const sniffSupportedMediaType = (bytes: Buffer): string | null => {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12)
    return brand === 'M4A '
      ? 'audio/mp4'
      : brand === 'qt  '
        ? 'video/quicktime'
        : 'video/mp4'
  }
  if (
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    return 'video/webm'
  }
  return null
}

const importMastodonMediaItem = async (
  context: AccountImportPhaseContext,
  archive: ZipArchive,
  item: AccountImportItem,
  maxBytes: number
) => {
  const entry = archive.entries.find(
    (candidate) => candidate.name === item.sourceId
  )
  if (!entry) return { state: 'skipped' as const, reason: 'media_missing' }
  if (entry.uncompressedSize > maxBytes) {
    return { state: 'skipped' as const, reason: 'media_too_large' }
  }
  const stream = await archive.openEntryStream(item.sourceId)
  const bytes = await readAsyncIterableToBufferWithLimit(
    chunksOf(stream),
    maxBytes,
    'Archived media'
  )
  const mediaType = sniffSupportedMediaType(bytes)
  if (!mediaType)
    return { state: 'skipped' as const, reason: 'media_type_unsupported' }
  const fileName = sanitizeStoredFileName(basename(item.sourceId))
  const file = new File([new Uint8Array(bytes)], fileName, { type: mediaType })
  const parsed = MediaSchema.safeParse({ file })
  if (!parsed.success)
    return { state: 'skipped' as const, reason: 'media_invalid' }
  await context.renew()
  const saved = await saveMedia(
    context.database,
    await requireActor(context),
    parsed.data,
    {
      withGalleryDetails: false
    }
  )
  if (!saved)
    return { state: 'skipped' as const, reason: 'storage_unavailable' }
  return { state: 'done' as const, targetId: saved.id }
}

const requireActor = async (
  context: AccountImportPhaseContext
): Promise<Actor> => {
  const actor = await context.database.getActorFromId({
    id: context.accountImport.actorId
  })
  if (!actor) throw new Error('import_actor_missing')
  return actor
}

// A media item's own defect (a zip-level problem with its entry) is a
// permanent skip. A changed archive is terminal for the import. A media
// validation failure — the account is over its storage quota, or the bytes
// cannot be decoded — is the item's verdict too, not a server fault, so it
// is a permanent skip with its own reason code. Anything else — storage or
// transport trouble — is recorded as a retryable failed item, never as a
// permanent media_invalid skip.
const handleMediaItemError = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem,
  error: unknown
) => {
  if (
    (error as Error)?.message === 'import_actor_missing' ||
    error instanceof AccountImportArchiveChangedError
  ) {
    throw error
  }
  if (error instanceof ZipArchiveError) {
    await terminalItemState(context, progress, item, 'skipped', 'media_invalid')
    return
  }
  if (error instanceof MediaValidationError) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      isQuotaExceededError(error) ? 'media_quota_exceeded' : 'media_invalid'
    )
    return
  }
  await handleItemError(context, progress, item, error)
}

// The quota verdict is the fixed prefix saveMedia's quota check raises with;
// the numbers after it never reach a row.
const isQuotaExceededError = (error: Error) =>
  error.message.startsWith('Storage quota exceeded')

const checkCancelled = async (context: AccountImportPhaseContext) => {
  const current = await context.database.getAccountImport({
    id: context.accountImport.id,
    actorId: context.accountImport.actorId
  })
  return current?.status === 'cancelled' || !current
}

export const runMastodonMediaPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
): Promise<{
  result: PhaseResult
  progress: AccountImportProgress
  cursor: string | null
}> => {
  const cursor = parseImportCursor(cursorText)
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const { media } = await getResolvedServerSettings(context.database)
    const maxBytes = media.maxFileSize
    let afterPosition = cursor.afterPosition ?? undefined
    for (;;) {
      const page = await context.database.getAccountImportItems({
        importId: context.accountImport.id,
        ...(afterPosition === undefined ? {} : { afterPosition }),
        kinds: ['media'],
        states: ['pending'],
        limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
      })
      if (page.length === 0) return { result: 'done', progress, cursor: null }
      for (const item of page) {
        if (await checkCancelled(context)) {
          return { result: 'cancelled', progress, cursor: null }
        }
        if (item.kind === 'media' && item.state === 'pending') {
          try {
            const saved = await importMastodonMediaItem(
              context,
              archive,
              item,
              maxBytes
            )
            await terminalItemState(
              context,
              progress,
              item,
              saved.state,
              saved.state === 'skipped' ? saved.reason : undefined,
              saved.state === 'done' ? saved.targetId : null
            )
          } catch (error) {
            await handleMediaItemError(context, progress, item, error)
          }
        }
        afterPosition = item.position
        if (context.now() >= context.deadline) {
          return {
            result: 'budget',
            progress,
            cursor: serializeImportCursor(afterPosition)
          }
        }
      }
      if (page.length < ACCOUNT_IMPORT_ITEM_PAGE_SIZE) {
        return { result: 'done', progress, cursor: null }
      }
    }
  } finally {
    await archive.close()
  }
}

const makeMapperContext = (
  actor: Actor,
  progress: AccountImportProgress,
  ownStatusIds: ReadonlySet<string>,
  options: AccountImportOptions,
  nowMs: number
) => ({
  actor,
  ownStatusIds,
  nowMs,
  sourceActorId: progress.sourceActorId ?? undefined,
  sourceFollowersUrl: progress.sourceFollowersUrl,
  repliesToOthers: options.repliesToOthers
})

const importStatusItem = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  actor: Actor,
  item: AccountImportItem,
  record: unknown,
  ownStatusIds: ReadonlySet<string>,
  mediaByArchivePath: Map<string, string>,
  targetBySourceId: Map<string, string>
): Promise<boolean> => {
  const options = selectedOptions(context, progress)
  const kind = context.accountImport.kind as AccountArchiveKind
  const mapped =
    kind === 'mastodon'
      ? mapMastodonItem(
          record,
          makeMapperContext(
            actor,
            progress,
            ownStatusIds,
            options,
            context.now()
          )
        )
      : mapOwnStatus(
          record,
          makeMapperContext(
            actor,
            progress,
            ownStatusIds,
            options,
            context.now()
          )
        )
  if (!mapped.ok) {
    await terminalItemState(context, progress, item, 'skipped', mapped.reason)
    return true
  }
  if (
    mapped.input.replyToStatusId &&
    ownStatusIds.has(mapped.input.replyToStatusId) &&
    !targetBySourceId.has(mapped.input.replyToStatusId)
  ) {
    // A source can list a reply before its parent. Leave it pending for the
    // next ordered pass so every parent in the archive is written first.
    return false
  }
  const input = statusInputWithTargetReferences(
    mapped.input,
    mediaByArchivePath,
    targetBySourceId
  )
  await context.renew()
  const status = await createImportedStatus(context.database, actor, input)
  await terminalItemState(context, progress, item, 'done', undefined, status.id)
  targetBySourceId.set(item.sourceId, status.id)
  return true
}

const importLikeItem = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  actor: Actor,
  item: AccountImportItem
) => {
  if (!selectedOptions(context, progress).likes) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'option_disabled'
    )
    return
  }
  const status = await context.database.getStatus({ statusId: item.sourceId })
  if (
    !status ||
    !(await isLocalFederationDomain(context.database, status.id)) ||
    !(await canActorReadStatus({
      database: context.database,
      status,
      currentActor: actor
    }))
  ) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'local_status_missing'
    )
    return
  }
  await context.renew()
  await context.database.createLike({ actorId: actor.id, statusId: status.id })
  await terminalItemState(context, progress, item, 'done')
}

const importBookmarkItem = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  actor: Actor,
  item: AccountImportItem
) => {
  if (!selectedOptions(context, progress).bookmarks) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'option_disabled'
    )
    return
  }
  await context.renew()
  // Allowed side effect: bookmarks use the same importRow path as a bookmarks CSV row.
  const result = await importRow({
    database: context.database,
    actor,
    type: 'bookmarks',
    data: { uri: item.sourceId }
  })
  await terminalItemState(
    context,
    progress,
    item,
    result.imported ? 'done' : 'skipped',
    result.imported ? undefined : 'bookmark_unavailable'
  )
}

// The replies whose own parent never became done (it was skipped or failed):
// another pass cannot resolve them, so they end as parent_unavailable.
const skipRemainingPendingStatuses = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress
) => {
  for (;;) {
    const remaining = await context.database.getAccountImportItems({
      importId: context.accountImport.id,
      kinds: ['status'],
      states: ['pending'],
      limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
    })
    if (remaining.length === 0) break
    for (const item of remaining) {
      await terminalItemState(
        context,
        progress,
        item,
        'skipped',
        'parent_unavailable'
      )
    }
  }
}

export const runStatusesPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
): Promise<{
  result: PhaseResult
  progress: AccountImportProgress
  cursor: string | null
}> => {
  const { afterPosition: cursorPosition } = parseImportCursor(cursorText)
  let afterPosition = cursorPosition ?? undefined
  // A null cursor begins a pass; a pass spans slices, so its baseline is
  // persisted in progress rather than recomputed at every slice.
  const passCompletedAtStart =
    cursorPosition === null
      ? progress.completedItems + progress.skippedItems
      : (progress.passCompletedAtStart ??
        progress.completedItems + progress.skippedItems)
  progress.passCompletedAtStart = passCompletedAtStart
  // Only a pass that resolved something may ask for another one. A pass
  // that made no progress would page through the same stuck replies
  // forever, so its leftovers are skipped instead.
  const madePassProgress = () =>
    progress.completedItems + progress.skippedItems > passCompletedAtStart
  const actor = await requireActor(context)
  for (;;) {
    const page = await context.database.getAccountImportItems({
      importId: context.accountImport.id,
      ...(afterPosition === undefined ? {} : { afterPosition }),
      kinds: ['status', 'like', 'bookmark'],
      states: ['pending'],
      limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
    })
    if (page.length === 0) {
      const processedPosition = afterPosition
      if (processedPosition !== undefined) {
        const earlierPending = await context.database.getAccountImportItems({
          importId: context.accountImport.id,
          kinds: ['status'],
          states: ['pending'],
          limit: 1
        })
        if (earlierPending.some((item) => item.position <= processedPosition)) {
          if (madePassProgress()) {
            return { result: 'budget', progress, cursor: null }
          }
          await skipRemainingPendingStatuses(context, progress)
        }
      }
      return { result: 'done', progress, cursor: null }
    }
    const kind = context.accountImport.kind as AccountArchiveKind
    const referencedStatusIds: string[] = []
    const referencedMediaIds: string[] = []
    for (const item of page) {
      if (item.kind !== 'status') continue
      const record = parseCatalogedItem(item.data)
      if (record === null) continue
      const references = collectStatusReferenceIds(record, kind)
      referencedStatusIds.push(...references.statusIds)
      referencedMediaIds.push(...references.mediaIds)
    }
    const references = await itemReferences(
      context,
      ['status', 'media', 'own-media'],
      [...referencedStatusIds, ...referencedMediaIds]
    )
    const ownStatusIds = new Set(
      references
        .filter((reference) => reference.kind === 'status')
        .map((reference) => reference.sourceId)
    )
    const targetBySourceId = targetMapForKind(references, 'status')
    const mediaByArchivePath = new Map<string, string>()
    for (const reference of references) {
      if (
        (reference.kind === 'media' || reference.kind === 'own-media') &&
        reference.state === 'done' &&
        reference.targetId
      ) {
        mediaByArchivePath.set(reference.sourceId, reference.targetId)
      }
    }
    for (const item of page) {
      if (await checkCancelled(context)) {
        return { result: 'cancelled', progress, cursor: null }
      }
      if (item.state === 'pending') {
        try {
          if (item.kind === 'status') {
            const record = parseCatalogedItem(item.data)
            if (record === null) {
              await terminalItemState(
                context,
                progress,
                item,
                'skipped',
                'archive_item_invalid'
              )
            } else {
              await importStatusItem(
                context,
                progress,
                actor,
                item,
                record,
                ownStatusIds,
                mediaByArchivePath,
                targetBySourceId
              )
            }
          } else if (item.kind === 'like') {
            await importLikeItem(context, progress, actor, item)
          } else if (item.kind === 'bookmark') {
            await importBookmarkItem(context, progress, actor, item)
          }
        } catch (error) {
          await handleItemError(context, progress, item, error)
        }
      }
      afterPosition = item.position
      if (context.now() >= context.deadline) {
        return {
          result: 'budget',
          progress,
          cursor: serializeImportCursor(afterPosition)
        }
      }
    }
    if (page.length < ACCOUNT_IMPORT_ITEM_PAGE_SIZE) {
      const remaining = await context.database.getAccountImportItems({
        importId: context.accountImport.id,
        kinds: ['status'],
        states: ['pending'],
        limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
      })
      if (remaining.length === 0) {
        return { result: 'done', progress, cursor: null }
      }
      if (madePassProgress()) {
        return { result: 'budget', progress, cursor: null }
      }
      await skipRemainingPendingStatuses(context, progress)
      return { result: 'done', progress, cursor: null }
    }
  }
}

const runCatalogedItems = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null,
  kinds: ReadonlySet<string>,
  process: (item: AccountImportItem) => Promise<void>,
  preparePage?: (page: AccountImportItem[]) => Promise<void>
): Promise<{
  result: PhaseResult
  progress: AccountImportProgress
  cursor: string | null
}> => {
  let afterPosition = parseImportCursor(cursorText).afterPosition ?? undefined
  for (;;) {
    const page = await context.database.getAccountImportItems({
      importId: context.accountImport.id,
      ...(afterPosition === undefined ? {} : { afterPosition }),
      kinds: [...kinds],
      states: ['pending'],
      limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
    })
    if (page.length === 0) return { result: 'done', progress, cursor: null }
    await preparePage?.(page)
    for (const item of page) {
      if (await checkCancelled(context)) {
        return { result: 'cancelled', progress, cursor: null }
      }
      try {
        await process(item)
      } catch (error) {
        await handleItemError(context, progress, item, error)
      }
      afterPosition = item.position
      if (context.now() >= context.deadline) {
        return {
          result: 'budget',
          progress,
          cursor: serializeImportCursor(afterPosition)
        }
      }
    }
  }
}

const sourceRecord = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  item: AccountImportItem
) => schema.safeParse(parseCatalogedItem(item.data))

const archiveTimestamp = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const importGalleryGear = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem
) => {
  const parsed = sourceRecord(ownGalleryGearSchema, item)
  if (
    !parsed.success ||
    !GALLERY_GEAR_KINDS.includes(parsed.data.kind as GalleryGearKind)
  ) {
    await terminalItemState(context, progress, item, 'skipped', 'gear_invalid')
    return
  }
  const actor = await requireActor(context)
  const row = parsed.data
  const existing = row.deviceKey
    ? await context.database.findGalleryGearByDeviceKey({
        actorId: actor.id,
        deviceKey: row.deviceKey
      })
    : null
  const gear =
    existing ??
    (await leasedWrite(context, () =>
      context.database.createGalleryGear({
        actorId: actor.id,
        kind: row.kind as GalleryGearKind,
        name: row.name,
        brand: row.brand,
        model: row.model,
        productUrl: row.productUrl,
        deviceKey: row.deviceKey
      })
    ))
  if (!existing && row.retiredAt !== null) {
    await leasedWrite(context, () =>
      context.database.setGalleryGearRetired({
        id: gear.id,
        actorId: actor.id,
        retired: true
      })
    )
  }
  await terminalItemState(context, progress, item, 'done', undefined, gear.id)
}

const importFitnessGear = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem
) => {
  const parsed = sourceRecord(ownFitnessGearSchema, item)
  if (
    !parsed.success ||
    !FITNESS_GEAR_KINDS.includes(parsed.data.kind as FitnessGearKind)
  ) {
    await terminalItemState(context, progress, item, 'skipped', 'gear_invalid')
    return
  }
  const actor = await requireActor(context)
  const row = parsed.data
  const existing = row.deviceKey
    ? await context.database.findFitnessGearByDeviceKey({
        actorId: actor.id,
        deviceKey: row.deviceKey
      })
    : null
  const gear =
    existing ??
    (await leasedWrite(context, () =>
      context.database.createFitnessGear({
        actorId: actor.id,
        kind: row.kind as FitnessGearKind,
        name: row.name,
        brand: row.brand,
        model: row.model,
        bikeType: row.bikeType,
        weightKilograms: row.weightKilograms,
        defaultSports: row.defaultSports ?? undefined,
        alertDistanceMeters: row.alertDistanceMeters,
        notes: row.notes,
        deviceKey: row.deviceKey,
        productUrl: row.productUrl
      })
    ))
  if (!existing) {
    for (const component of row.components) {
      const period = [...component.periods].sort(
        (a, b) => a.installSequence - b.installSequence
      )[0]
      await leasedWrite(context, () =>
        context.database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actor.id,
          componentType: component.componentType,
          brand: component.brand,
          model: component.model,
          serviceDistanceMeters: component.serviceDistanceMeters,
          productUrl: component.productUrl,
          addedAt: archiveTimestamp(period?.addedAt)
            ? new Date(archiveTimestamp(period?.addedAt) as number)
            : null,
          removedAt: archiveTimestamp(period?.removedAt)
            ? new Date(archiveTimestamp(period?.removedAt) as number)
            : null
        })
      )
    }
    if (row.retiredAt !== null) {
      await leasedWrite(context, () =>
        context.database.setFitnessGearRetired({
          id: gear.id,
          actorId: actor.id,
          retired: true
        })
      )
    }
  }
  await terminalItemState(context, progress, item, 'done', undefined, gear.id)
}

export const runGearsPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
) =>
  runCatalogedItems(
    context,
    progress,
    cursorText,
    new Set(['gallery-gear', 'fitness-gear']),
    async (item) => {
      if (item.kind === 'gallery-gear') {
        await importGalleryGear(context, progress, item)
      } else {
        await importFitnessGear(context, progress, item)
      }
    }
  )

const archiveMediaFileName = (id: number, mediaType: string) => {
  const extension: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/quicktime': 'mov',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mp4': 'm4a'
  }
  return `archive-media-${id}.${extension[mediaType] ?? 'bin'}`
}

const readOwnMediaFile = async (
  context: AccountImportPhaseContext,
  archive: ZipArchive,
  item: AccountImportItem,
  maxBytes: number,
  galleryGears: ReadonlyMap<string, string>
) => {
  const parsed = ownMediaLineSchema.safeParse(
    normalizeOwnMediaRecord(parseCatalogedItem(item.data))
  )
  if (!parsed.success || !parsed.data.archivePath) {
    return { state: 'skipped' as const, reason: 'media_missing' }
  }
  const entry = archive.entries.find(
    (candidate) => candidate.name === parsed.data.archivePath
  )
  if (!entry) return { state: 'skipped' as const, reason: 'media_missing' }
  if (entry.uncompressedSize > maxBytes) {
    return { state: 'skipped' as const, reason: 'media_too_large' }
  }
  const bytes = await readAsyncIterableToBufferWithLimit(
    chunksOf(await archive.openEntryStream(entry.name)),
    maxBytes,
    'Archived media'
  )
  const sniffedType = sniffSupportedMediaType(bytes)
  if (!sniffedType) {
    return { state: 'skipped' as const, reason: 'media_type_unsupported' }
  }
  if (!ACCEPTED_FILE_TYPES.includes(sniffedType)) {
    return { state: 'skipped' as const, reason: 'media_type_unsupported' }
  }
  const file = new File(
    [new Uint8Array(bytes)],
    archiveMediaFileName(parsed.data.id, sniffedType),
    { type: sniffedType }
  )
  const mediaInput = MediaSchema.safeParse({ file })
  if (!mediaInput.success) {
    return { state: 'skipped' as const, reason: 'media_invalid' }
  }
  const actor = await requireActor(context)
  await context.renew()
  const saved = await saveMedia(context.database, actor, mediaInput.data, {
    withGalleryDetails: false
  })
  if (!saved)
    return { state: 'skipped' as const, reason: 'storage_unavailable' }

  const data = parsed.data
  const cameraGearId = data.cameraGearId
    ? (galleryGears.get(data.cameraGearId) ?? null)
    : null
  const lensGearId = data.lensGearId
    ? (galleryGears.get(data.lensGearId) ?? null)
    : null
  const focus =
    data.focusX !== null && data.focusY !== null
      ? { x: data.focusX, y: data.focusY }
      : undefined
  await leasedWrite(context, () =>
    context.database.updateMedia({
      mediaId: saved.id,
      accountId: actor.account!.id,
      actorId: actor.id,
      description: data.description,
      ...(focus ? { focus } : null),
      blurhash: data.blurhash,
      details: {
        subjectName: data.subjectName,
        subjectScientificName: data.subjectScientificName,
        subjectCategory: data.subjectCategory,
        takenAt: archiveTimestamp(data.takenAt),
        cameraGearId,
        lensGearId,
        exposure: data.exposure,
        placeName: data.placeNameSource === 'geocoder' ? null : data.placeName,
        placeLatitude: data.placeLatitude ?? null,
        placeLongitude: data.placeLongitude ?? null,
        placePrecision: data.placePrecision,
        inGallery: data.inGallery,
        subjectTaxonKey: data.subjectTaxonKey
      }
    })
  )
  if (data.inGallery && data.galleryAddedAt !== null) {
    await leasedWrite(context, () =>
      context.database.addMediaToGallery({
        actorId: actor.id,
        mediaIds: [saved.id]
      })
    )
  }
  await leasedWrite(context, () =>
    context.database.setMediaSubjectLookup({
      mediaId: saved.id,
      expect: {
        subjectName: data.subjectName,
        subjectScientificName: data.subjectScientificName,
        subjectTaxonKey: data.subjectTaxonKey,
        subjectCategory: data.subjectCategory
      },
      patch: {
        subjectLookupStatus:
          data.subjectTaxonPath !== null || data.subjectIucnCategory !== null
            ? 'resolved'
            : null,
        subjectTaxonKey: data.subjectTaxonKey,
        subjectTaxonPath: data.subjectTaxonPath,
        subjectIucnCategory: data.subjectIucnCategory
      }
    })
  )
  await leasedWrite(context, () =>
    context.database.setMediaPlaceLookup({
      mediaId: saved.id,
      expect: {
        placeLatitude: data.placeLatitude ?? null,
        placeLongitude: data.placeLongitude ?? null
      },
      patch: {
        placeLookupStatus:
          data.placeCountryCode !== null || data.placeNameSource === 'geocoder'
            ? 'resolved'
            : null,
        placeCountryCode: data.placeCountryCode,
        ...(data.placeNameSource === 'geocoder'
          ? { placeName: data.placeName }
          : null)
      }
    })
  )
  await leasedWrite(context, () =>
    context.database.setMediaSubjectSuggestions({
      mediaId: saved.id,
      suggestions: data.subjectSuggestions
    })
  )
  return { state: 'done' as const, targetId: saved.id }
}

export const runOwnArchiveMediaPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
) => {
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const { media } = await getResolvedServerSettings(context.database)
    let galleryGears = new Map<string, string>()
    return await runCatalogedItems(
      context,
      progress,
      cursorText,
      new Set(['own-media']),
      async (item) => {
        try {
          const result = await readOwnMediaFile(
            context,
            archive,
            item,
            media.maxFileSize,
            galleryGears
          )
          await terminalItemState(
            context,
            progress,
            item,
            result.state,
            result.state === 'skipped' ? result.reason : undefined,
            result.state === 'done' ? result.targetId : null
          )
        } catch (error) {
          await handleMediaItemError(context, progress, item, error)
        }
      },
      async (page) => {
        const gearIds = page.flatMap((item) => {
          const parsed = sourceRecord(ownMediaLineSchema, item)
          return parsed.success
            ? [parsed.data.cameraGearId, parsed.data.lensGearId].filter(
                (id): id is string => id !== null
              )
            : []
        })
        const references = await itemReferences(
          context,
          ['gallery-gear'],
          gearIds
        )
        galleryGears = targetMapForKind(references, 'gallery-gear')
      }
    )
  } finally {
    await archive.close()
  }
}

const importAlbum = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem,
  mediaMap: ReadonlyMap<string, string>
) => {
  const parsed = sourceRecord(ownAlbumSchema, item)
  if (!parsed.success) {
    await terminalItemState(context, progress, item, 'skipped', 'album_invalid')
    return
  }
  const actor = await requireActor(context)
  const mediaIds = parsed.data.items
    .map(({ mediaId }) => mediaMap.get(String(mediaId)))
    .filter((id): id is string => Boolean(id))
    .slice(0, MAX_GALLERY_ALBUM_ITEMS)
  const sortOrder = GALLERY_ALBUM_SORTS.includes(parsed.data.sortOrder)
    ? parsed.data.sortOrder
    : 'taken_desc'
  const created = await leasedWrite(context, () =>
    context.database.createGalleryAlbumWithinLimit({
      actorId: actor.id,
      title: parsed.data.title.slice(0, MAX_GALLERY_ALBUM_TITLE_LENGTH),
      description:
        parsed.data.description?.slice(
          0,
          MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH
        ) ?? null,
      visibility: parsed.data.visibility,
      sortOrder,
      limit: MAX_GALLERY_ALBUMS_PER_ACTOR,
      itemLimit: MAX_GALLERY_ALBUM_ITEMS,
      mediaIds
    })
  )
  if (created.status !== 'created') {
    await terminalItemState(context, progress, item, 'skipped', 'album_limit')
    return
  }
  const coverMediaId =
    parsed.data.coverMediaId === null
      ? null
      : (mediaMap.get(String(parsed.data.coverMediaId)) ?? null)
  if (coverMediaId) {
    await leasedWrite(context, () =>
      context.database.updateGalleryAlbum({
        id: created.album.id,
        actorId: actor.id,
        coverMediaId
      })
    )
  }
  await terminalItemState(
    context,
    progress,
    item,
    'done',
    undefined,
    created.album.id
  )
}

export const runAlbumsPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
) => {
  let mediaMap = new Map<string, string>()
  return runCatalogedItems(
    context,
    progress,
    cursorText,
    new Set(['album']),
    (item) => importAlbum(context, progress, item, mediaMap),
    async (page) => {
      const mediaIds = page.flatMap((item) => {
        const parsed = sourceRecord(ownAlbumSchema, item)
        return parsed.success
          ? [
              ...parsed.data.items.map(({ mediaId }) => String(mediaId)),
              ...(parsed.data.coverMediaId === null
                ? []
                : [String(parsed.data.coverMediaId)])
            ]
          : []
      })
      const references = await itemReferences(
        context,
        ['own-media', 'media'],
        mediaIds
      )
      mediaMap = new Map(
        references
          .filter(
            (reference) =>
              reference.state === 'done' && reference.targetId !== null
          )
          .map((reference) => [
            reference.sourceId,
            reference.targetId as string
          ])
      )
    }
  )
}

const importFitnessFile = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  archive: ZipArchive,
  item: AccountImportItem,
  targetStatuses: ReadonlyMap<string, string>,
  targetGear: ReadonlyMap<string, string>
) => {
  const parsed = sourceRecord(ownFitnessFileLineSchema, item)
  if (
    !parsed.success ||
    !['fit', 'gpx', 'tcx'].includes(parsed.data.fileType)
  ) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'fitness_invalid'
    )
    return
  }
  const source = parsed.data
  const targetStatusId = source.statusId
    ? targetStatuses.get(source.statusId)
    : null
  if (!targetStatusId) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'status_unavailable'
    )
    return
  }
  const entry = archive.entries.find(({ name }) => name === source.archivePath)
  if (!entry) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'fitness_missing'
    )
    return
  }
  const configuredLimit = getConfig().fitnessStorage?.maxFileSize
  const maxBytes = configuredLimit ?? DEFAULT_FITNESS_MAX_FILE_SIZE
  if (entry.uncompressedSize > maxBytes) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'fitness_too_large'
    )
    return
  }
  const bytes = await readAsyncIterableToBufferWithLimit(
    chunksOf(await archive.openEntryStream(entry.name)),
    maxBytes,
    'Archived fitness file'
  )
  const fileType = source.fileType as 'fit' | 'gpx' | 'tcx'
  const mimeType =
    fileType === 'fit'
      ? 'application/vnd.ant.fit'
      : fileType === 'gpx'
        ? 'application/gpx+xml'
        : 'application/tcx+xml'
  const fileName = sanitizeStoredFileName(`${source.id}.${fileType}`)
  const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType })
  const upload = FitnessFileUploadSchema.safeParse({
    file,
    description: source.description ?? undefined
  })
  if (!upload.success) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'fitness_invalid'
    )
    return
  }
  const actor = await requireActor(context)
  await context.renew()
  const saved = await saveFitnessFile(context.database, actor, upload.data)
  if (!saved) {
    await terminalItemState(
      context,
      progress,
      item,
      'skipped',
      'storage_unavailable'
    )
    return
  }
  await leasedWrite(context, () =>
    context.database.updateFitnessFileStatus(saved.id, targetStatusId)
  )
  await leasedWrite(context, () =>
    context.database.updateFitnessFileActivityData(saved.id, {
      activityType: source.activityType,
      activityStartTime: source.activityStartTime
        ? new Date(source.activityStartTime)
        : null,
      totalDistanceMeters: source.totalDistanceMeters,
      totalDurationSeconds: source.totalDurationSeconds,
      movingTimeSeconds: source.movingTimeSeconds,
      elevationGainMeters: source.elevationGainMeters,
      deviceManufacturer: source.deviceManufacturer,
      deviceName: source.deviceName,
      sourceUrl: source.sourceUrl,
      deviceGearId: source.deviceGearId
        ? (targetGear.get(source.deviceGearId) ?? null)
        : null
    })
  )
  const targetGearId = source.gearId
    ? (targetGear.get(source.gearId) ?? null)
    : null
  if (targetGearId) {
    await leasedWrite(context, () =>
      context.database.setFitnessFileGear({
        fitnessFileId: saved.id,
        actorId: actor.id,
        gearId: targetGearId
      })
    )
  }
  if (source.isPrimary)
    await leasedWrite(context, () =>
      context.database.updateFitnessFilePrimary(saved.id, true)
    )
  // This is the only queue publication allowed inside the quiet importer.
  await leasedWrite(context, () =>
    getQueue().publish({
      id: getHashFromString(
        `${context.accountImport.id}:fitness:${item.sourceId}`
      ),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId: targetStatusId,
        fitnessFileId: saved.id,
        publishSendNote: false,
        notifyOnComplete: false
      }
    })
  )
  await terminalItemState(context, progress, item, 'done', undefined, saved.id)
}

// The same caps the profile route's PATCH applies to a name and a bio it did
// not already have stored (NAME_MAX_LENGTH / SUMMARY_MAX_LENGTH there).
const PROFILE_NAME_MAX_LENGTH = 255
const PROFILE_SUMMARY_MAX_LENGTH = 500

/**
 * The archive entry an actor.json image URL names, or null. The URL is never
 * retrieved: only a name the archive itself carries is used, so a Mastodon
 * archive whose icon points at a remote file simply has no image to import.
 */
const profileImageEntryName = (
  url: string,
  entries: readonly ZipCatalogEntry[]
): string | null => {
  let candidate = url
  try {
    if (URL.canParse(url)) {
      candidate = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '')
    }
  } catch {
    return null
  }
  if (candidate.includes('\\') || candidate.includes('\0')) return null
  if (
    candidate.split('/').some((segment) => segment === '' || segment === '..')
  ) {
    return null
  }
  return entries.some((entry) => entry.name === candidate) ? candidate : null
}

/**
 * Why a profile image was refused instead of saved. The same reason codes
 * the media phase writes to an item row; the profile phase has no item
 * rows, so its skips are recorded on the import's progress instead.
 */
export type ProfileImageSkipReason = 'media_quota_exceeded' | 'media_invalid'

/** One profile image's outcome: saved, refused with a reason, or absent. */
type ProfileImageResult =
  | { state: 'saved'; url: string; mediaId: string }
  | { state: 'skipped'; reason: ProfileImageSkipReason }
  | { state: 'absent' }

/**
 * Saves one profile image from the archive's own bytes through the same media
 * path the profile routes use (MediaSchema, the image type check, the decode
 * check, saveMedia). The MIME type is sniffed from the bytes, never taken from
 * the entry name or the archive's claim. Every refusal the bytes earn — not a
 * stored png or jpeg, a failed media schema, a failed decode, or the media
 * path's own verdict — is a skip carrying its reason, so the owner can see
 * why an image did not land; a missing, over-size or unreadable entry, or
 * a store that saved nothing, is absent.
 */
const importProfileImage = async (
  context: AccountImportPhaseContext,
  archive: ZipArchive,
  actor: Actor,
  url: string | undefined,
  maxBytes: number
): Promise<ProfileImageResult> => {
  const entryName = url ? profileImageEntryName(url, archive.entries) : null
  if (!entryName) return { state: 'absent' }
  const entry = archive.entries.find(
    (candidate) => candidate.name === entryName
  )
  if (!entry || entry.uncompressedSize > maxBytes) return { state: 'absent' }
  let bytes: Buffer
  try {
    const stream = await archive.openEntryStream(entryName)
    bytes = await readAsyncIterableToBufferWithLimit(
      chunksOf(stream),
      maxBytes,
      'Archived profile image'
    )
  } catch (error) {
    // Only the image's own verdicts are a skip: a defective entry
    // (ZipArchiveError) or an image over the size cap. A changed archive is
    // terminal for the import and a storage failure must not be silently
    // forgotten, so both reach the caller the way the media phase treats
    // them.
    if (error instanceof ZipArchiveError) return { state: 'absent' }
    if (error instanceof StreamByteLimitError) return { state: 'absent' }
    throw error
  }
  const mediaType = sniffSupportedMediaType(bytes)
  if (!mediaType || !ACCEPTED_IMAGE_TYPES.includes(mediaType)) {
    return { state: 'skipped', reason: 'media_invalid' }
  }
  const file = new File(
    [new Uint8Array(bytes)],
    sanitizeStoredFileName(basename(entryName)),
    { type: mediaType }
  )
  const parsed = MediaSchema.safeParse({ file })
  if (!parsed.success) return { state: 'skipped', reason: 'media_invalid' }
  try {
    await readValidThumbnail(file)
  } catch {
    return { state: 'skipped', reason: 'media_invalid' }
  }
  await context.renew()
  let saved: Awaited<ReturnType<typeof saveMedia>>
  try {
    saved = await saveMedia(context.database, actor, parsed.data)
  } catch (error) {
    // The media path's own verdict on the image — the account is over its
    // storage quota, or the bytes fail its validation — skips the image
    // the way the media phase skips an item, instead of failing the whole
    // import. Anything else (a storage fault) still reaches the caller.
    if (error instanceof MediaValidationError) {
      return {
        state: 'skipped',
        reason: isQuotaExceededError(error)
          ? 'media_quota_exceeded'
          : 'media_invalid'
      }
    }
    throw error
  }
  if (!saved) return { state: 'absent' }
  return { state: 'saved', url: saved.url, mediaId: saved.id }
}

/**
 * Best-effort cleanup of a profile image the phase stored but will not
 * apply: the row goes first and reports its storage paths, then each file
 * is deleted, the way a replaced map media is cleaned up. A failure is
 * logged, never thrown — the phase is already failing for its own reason.
 */
const deleteSavedProfileImage = async (
  context: AccountImportPhaseContext,
  mediaId: string
) => {
  try {
    const deleted = await context.database.deleteMediaWithFiles({ mediaId })
    if (deleted.status !== 'deleted') return
    await Promise.allSettled(
      deleted.files.map((path) => deleteMediaFile(context.database, path))
    )
  } catch (error) {
    logger.warn({
      message: 'Failed to delete an orphaned imported profile image',
      importId: context.accountImport.id,
      err: toArchiveLoggableError(error)
    })
  }
}

export interface ProfileSettingsPhaseResult {
  result: PhaseResult
  progress: AccountImportProgress
  /**
   * Why the avatar or header was refused instead of saved, if either was.
   * The profile phase has no item rows, so these skips are recorded on the
   * progress (shown by GET /api/v1/account/imports/:id), returned here and
   * logged rather than recorded on the catalog.
   */
  imageSkipReasons?: readonly ProfileImageSkipReason[]
}

/**
 * The profile option: the display name, bio, fields, avatar and header of the
 * archive's actor document, applied with the profile route's own validation
 * (its field normalizer and its length caps). movedTo, alsoKnownAs, verifiedAt
 * and every key outside the profile route's schema are ignored, and the images
 * come only from the archive's own files. At most one publishActorUpdate leaves
 * the phase, and only when the stored profile actually changed.
 */
export const runProfilePhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress
): Promise<ProfileSettingsPhaseResult> => {
  if (!selectedOptions(context, progress).profile) {
    return { result: 'done', progress }
  }
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const document = requiredEntry(archive.entries, 'actor.json')
      ? await readTopLevelJsonFields(
          chunksOf(await archive.openEntryStream('actor.json')),
          [
            'id',
            'preferredUsername',
            'name',
            'summary',
            'attachment',
            'icon',
            'image'
          ]
        )
      : null
    const actorDocument = mastodonActorSchema.safeParse(document)
    if (!actorDocument.success) return { result: 'done', progress }
    const source = actorDocument.data
    const actor = await requireActor(context)
    const patch: Pick<
      UpdateActorParams,
      'name' | 'summary' | 'fields' | 'iconUrl' | 'headerImageUrl'
    > = {}
    if (
      source.name !== undefined &&
      source.name.length <= PROFILE_NAME_MAX_LENGTH
    ) {
      patch.name = source.name
    }
    if (
      source.summary !== undefined &&
      source.summary.length <= PROFILE_SUMMARY_MAX_LENGTH
    ) {
      patch.summary = source.summary
    }
    if (source.attachment !== undefined) {
      // The profile route's own field schema: the same trim, limits and
      // at-most-four rule the JSON editor's save applies.
      const fields = normalizeProfileFieldRows(
        source.attachment.map((field) => ({
          name: field.name,
          value: field.value
        }))
      )
      if (fields.status === 'ok') patch.fields = fields.fields
    }
    const { media } = await getResolvedServerSettings(context.database)
    const imageSkipReasons: ProfileImageSkipReason[] = []
    const icon = await importProfileImage(
      context,
      archive,
      actor,
      source.icon?.url,
      media.maxFileSize
    )
    if (icon.state === 'saved') patch.iconUrl = icon.url
    else if (icon.state === 'skipped') imageSkipReasons.push(icon.reason)
    let header: ProfileImageResult | null = null
    let updated: Awaited<
      ReturnType<typeof context.database.updateActorWithPrevious>
    >
    try {
      header = await importProfileImage(
        context,
        archive,
        actor,
        source.image?.url,
        media.maxFileSize
      )
      if (header.state === 'saved') patch.headerImageUrl = header.url
      else if (header.state === 'skipped') imageSkipReasons.push(header.reason)
      if (imageSkipReasons.length > 0) {
        progress.profileImageSkips = [...imageSkipReasons]
      }
      for (const reason of imageSkipReasons) {
        logger.info({
          message: 'Account import skipped a profile image',
          importId: context.accountImport.id,
          reason
        })
      }
      if (Object.keys(patch).length === 0) {
        return { result: 'done', progress, imageSkipReasons }
      }
      await context.renew()
      updated = await context.database.updateActorWithPrevious({
        actorId: context.accountImport.actorId,
        ...patch
      })
    } catch (error) {
      // The phase is failing after images may have been stored: a
      // cancellation or a lost lease at the renew, or the profile update's
      // own failure. Every image this run saved is deleted rather than left
      // behind: nothing references it yet, and its bytes still count
      // against the quota.
      if (icon.state === 'saved') {
        await deleteSavedProfileImage(context, icon.mediaId)
      }
      if (header?.state === 'saved') {
        await deleteSavedProfileImage(context, header.mediaId)
      }
      throw error
    }
    const { before, after } = updated
    // The one federated side effect the importer is allowed: a single
    // Update(Person), and only for a change to what the Person carries.
    if (after && (!before || hasFederatedProfileChange(before, after))) {
      await publishActorUpdate({ actorId: context.accountImport.actorId })
    }
    return { result: 'done', progress, imageSkipReasons }
  } finally {
    await archive.close()
  }
}

export const runFitnessPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  cursorText: string | null
) => {
  let targetStatuses = new Map<string, string>()
  let targetGear = new Map<string, string>()
  // One open per slice, not per file: every open re-reads the trailer and
  // the whole central directory, which is megabytes on a large archive.
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    return await runCatalogedItems(
      context,
      progress,
      cursorText,
      new Set(['fitness-file']),
      (item) =>
        importFitnessFile(
          context,
          progress,
          archive,
          item,
          targetStatuses,
          targetGear
        ),
      async (page) => {
        const sourceIds = page.flatMap((item) => {
          const parsed = sourceRecord(ownFitnessFileLineSchema, item)
          if (!parsed.success) return []
          return [
            ...(parsed.data.statusId ? [parsed.data.statusId] : []),
            ...(parsed.data.gearId ? [parsed.data.gearId] : []),
            ...(parsed.data.deviceGearId ? [parsed.data.deviceGearId] : [])
          ]
        })
        const references = await itemReferences(
          context,
          ['status', 'fitness-gear'],
          sourceIds
        )
        targetStatuses = targetMapForKind(references, 'status')
        targetGear = targetMapForKind(references, 'fitness-gear')
      }
    )
  } finally {
    await archive.close()
  }
}

export const runCollectionsNoopPhase = async () => 'done' as const
// The actor settings the settings option may restore, each validated with the
// schema the app's own write path for that key uses. An explicit allowlist:
// a key added to the export later stays out until someone opts it in here.
// Deliberately NOT importable, with why:
// - iconUrl, headerImageUrl, fields, avatarDescription, headerDescription:
//   profile data, which only the profile option restores (images from the
//   archive's own files, never a URL).
// - movedTo, alsoKnownAs: moved state.
// - attributionDomains: which domains may credit this account (anti-spoofing
//   trust, i.e. identity).
// - bot: account identity.
// - tags: profile decoration.
// - emailNotifications, pushNotifications: delivery channel toggles for the
//   account's own email/push endpoints.
// - notificationAcceptedSenders: a per-sender moderation list.
const ACTOR_SETTING_IMPORT_KEYS: Record<string, z.ZodTypeAny> = {
  // Posting defaults (update_credentials `source.*`).
  defaultPrivacy: Visibility,
  defaultSensitive: z.boolean(),
  defaultLanguage: z.string().max(20),
  defaultQuotePolicy: QuoteApprovalPolicy,
  // The profile form's post line limit values.
  postLineLimit: z
    .number()
    .int()
    .refine((value) =>
      (POST_LINE_LIMIT_VALUES as readonly number[]).includes(value)
    ),
  // The reading-preferences route's enum and booleans.
  readingExpandMedia: z.enum(['default', 'show_all', 'hide_all']),
  readingExpandSpoilers: z.boolean(),
  readingAutoplayGifs: z.boolean(),
  // The notification policy the v2 policy route writes, as one whole object.
  notificationPolicy: z.object({
    for_not_following: NotificationPolicyValue,
    for_not_followers: NotificationPolicyValue,
    for_new_accounts: NotificationPolicyValue,
    for_private_mentions: NotificationPolicyValue,
    for_limited_accounts: NotificationPolicyValue
  }),
  // Profile tab visibility flags (PATCH /api/v1/profile).
  showMedia: z.boolean(),
  showMediaReplies: z.boolean(),
  showFeatured: z.boolean(),
  // Discovery and follow-policy preferences.
  discoverable: z.boolean(),
  indexable: z.boolean(),
  hideCollections: z.boolean(),
  manuallyApprovesFollowers: z.boolean()
}

// The gallery settings the settings option may restore, each with the key's
// own validator in UpdateGallerySettingsRequest (the gallery settings route's
// schema). The row's bookkeeping (actorId, createdAt, updatedAt) is not
// listed and never written. Fitness settings are not restored at all: a
// fitness_settings row belongs to an OAuth provider link (client id and
// secret, access tokens), which is exactly the auth material the importer
// must never touch.
const GALLERY_SETTING_IMPORT_KEYS: Record<string, z.ZodTypeAny> = {
  autoDescribe: UpdateGallerySettingsRequest.shape.autoDescribe,
  allowEmptyDescription:
    UpdateGallerySettingsRequest.shape.allowEmptyDescription,
  subjectHashtags: UpdateGallerySettingsRequest.shape.subjectHashtags,
  galleryDefault: UpdateGallerySettingsRequest.shape.galleryDefault,
  defaultPlacePrecision:
    UpdateGallerySettingsRequest.shape.defaultPlacePrecision,
  showGear: UpdateGallerySettingsRequest.shape.showGear,
  mapPublic: UpdateGallerySettingsRequest.shape.mapPublic,
  lifeListPublic: UpdateGallerySettingsRequest.shape.lifeListPublic,
  // The owner's own privacy zones; the export may already carry them emptied.
  hiddenLocations: UpdateGallerySettingsRequest.shape.hiddenLocations,
  hideThreatenedPlaces: UpdateGallerySettingsRequest.shape.hideThreatenedPlaces,
  subjectSuggestionMode:
    UpdateGallerySettingsRequest.shape.subjectSuggestionMode,
  subjectConfidenceThreshold:
    UpdateGallerySettingsRequest.shape.subjectConfidenceThreshold,
  photoEnhance: UpdateGallerySettingsRequest.shape.photoEnhance
}

const importAllowlistedSettings = (
  values: Record<string, unknown>,
  schemas: Record<string, z.ZodTypeAny>
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(schemas)) {
    if (!(key in values)) continue
    const parsed = schema.safeParse(values[key])
    // A value the schema refuses is dropped, key and all; the rest of the
    // restore goes on.
    if (parsed.success) patch[key] = parsed.data
  }
  return patch
}

/**
 * The settings option: the preference settings of this server's own export
 * (a Mastodon archive carries none), restored key by key through the
 * explicit allowlists above. Nothing here federates or notifies.
 */
export const runSettingsPhase = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress
): Promise<ProfileSettingsPhaseResult> => {
  if (!selectedOptions(context, progress).settings) {
    return { result: 'done', progress }
  }
  if (
    (context.accountImport.kind as AccountArchiveKind) !== 'activities.next'
  ) {
    return { result: 'done', progress }
  }
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const sourceExtrasDir = await resolveOwnArchiveExtrasDir(
      archive,
      progress,
      'activities.next'
    )
    if (!sourceExtrasDir) return { result: 'done', progress }
    const profilePath = `${sourceExtrasDir}/profile.json`
    const profileDocument = requiredEntry(archive.entries, profilePath)
      ? await readTopLevelJsonFields(
          chunksOf(await archive.openEntryStream(profilePath)),
          ['settings']
        )
      : null
    const settings =
      profileDocument &&
      typeof profileDocument === 'object' &&
      'settings' in profileDocument &&
      typeof (profileDocument as Record<string, unknown>).settings === 'object'
        ? ((profileDocument as Record<string, unknown>).settings as Record<
            string,
            unknown
          >)
        : null
    if (settings) {
      const patch = importAllowlistedSettings(
        settings,
        ACTOR_SETTING_IMPORT_KEYS
      )
      if (Object.keys(patch).length > 0) {
        await context.renew()
        await context.database.updateActor({
          actorId: context.accountImport.actorId,
          ...(patch as Partial<UpdateActorParams>)
        })
      }
    }
    const galleryPath = `${sourceExtrasDir}/gallery/settings.json`
    const galleryRow = requiredEntry(archive.entries, galleryPath)
      ? await readTopLevelJsonFields(
          chunksOf(await archive.openEntryStream(galleryPath)),
          gallerySettingsFields
        )
      : null
    if (galleryRow && typeof galleryRow === 'object') {
      const patch = importAllowlistedSettings(
        galleryRow as Record<string, unknown>,
        GALLERY_SETTING_IMPORT_KEYS
      )
      if (Object.keys(patch).length > 0) {
        await context.renew()
        await context.database.updateGallerySettings({
          actorId: context.accountImport.actorId,
          ...(patch as Partial<
            Parameters<Database['updateGallerySettings']>[0]
          >)
        })
      }
    }
    return { result: 'done', progress }
  } finally {
    await archive.close()
  }
}

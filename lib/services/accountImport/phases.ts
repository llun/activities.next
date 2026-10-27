import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'

import type { UpdateActorParams } from '@/lib/database/domains/actor/types'
import type { Database } from '@/lib/database/types'
import {
  ACCOUNT_IMPORT_BOOKMARK_POSITION,
  ACCOUNT_IMPORT_CATALOG_PAGE_SIZE,
  ACCOUNT_IMPORT_ITEM_PAGE_SIZE,
  ACCOUNT_IMPORT_LIKE_POSITION,
  ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS,
  ACCOUNT_IMPORT_MAX_ITEMS,
  ACCOUNT_IMPORT_MEDIA_POSITION
} from '@/lib/services/accountImport/constants'
import { createImportedStatus } from '@/lib/services/accountImport/createImportedStatus'
import { detectArchiveKind } from '@/lib/services/accountImport/detectArchiveKind'
import { iterateJsonlLines } from '@/lib/services/accountImport/json/jsonl'
import { iterateOrderedItems } from '@/lib/services/accountImport/json/orderedItems'
import { readTopLevelStringFields } from '@/lib/services/accountImport/json/topLevelStringFields'
import { mapMastodonItem } from '@/lib/services/accountImport/mappers/mapMastodonItem'
import { mapOwnStatus } from '@/lib/services/accountImport/mappers/mapOwnStatus'
import type { ImportedStatusInput } from '@/lib/services/accountImport/mappers/types'
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
import { UpdateGallerySettingsRequest } from '@/lib/services/gallery/galleryRequests'
import { importRow } from '@/lib/services/imports/importRow'
import { saveMedia } from '@/lib/services/medias'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'
import { sanitizeStoredFileName } from '@/lib/services/medias/fileName'
import { readValidThumbnail } from '@/lib/services/medias/thumbnailInput'
import { MediaSchema } from '@/lib/services/medias/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { NotificationPolicyValue } from '@/lib/types/database/operations'
import { POST_LINE_LIMIT_VALUES } from '@/lib/types/database/rows'
import type {
  AccountImport,
  AccountImportItem
} from '@/lib/types/domain/accountImport'
import type { Actor } from '@/lib/types/domain/actor'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { readAsyncIterableToBufferWithLimit } from '@/lib/utils/streamLimit'

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
  kind: AccountArchiveKind
): Promise<ArchiveStatusOrder> => {
  const name =
    kind === 'mastodon' ? 'outbox.json' : 'activities.next/statuses.jsonl'
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

const statusPosition = (index: number, order: ArchiveStatusOrder) =>
  order === 'oldest-first' ? index + 1 : ACCOUNT_IMPORT_MAX_ITEMS - index

const statusIndex = (position: number, order: ArchiveStatusOrder) =>
  order === 'oldest-first' ? position - 1 : ACCOUNT_IMPORT_MAX_ITEMS - position

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

const listEventStream = async (
  archive: ZipArchive,
  kind: AccountArchiveKind,
  stage: Exclude<CatalogStage, 'done'>
) => {
  if (stage === 'statuses') {
    const name =
      kind === 'mastodon' ? 'outbox.json' : 'activities.next/statuses.jsonl'
    if (!requiredEntry(archive.entries, name)) return null
    return kind === 'mastodon'
      ? iterateOrderedItems(chunksOf(await archive.openEntryStream(name)))
      : iterateJsonlLines(chunksOf(await archive.openEntryStream(name)))
  }
  const name = stage === 'likes' ? 'likes.json' : 'bookmarks.json'
  if (!requiredEntry(archive.entries, name)) return null
  return iterateOrderedItems(chunksOf(await archive.openEntryStream(name)))
}

export const runCatalogPhase = async (
  context: AccountImportPhaseContext,
  progressInput: AccountImportProgress
): Promise<{
  result: PhaseResult
  progress: AccountImportProgress
  cursor: string | null
}> => {
  const progress = { ...progressInput }
  const archive = await openArchive(context.objectStore, context.accountImport)
  try {
    const kind = context.accountImport.kind as AccountArchiveKind
    if (
      progress.statusOrder !== 'oldest-first' &&
      progress.catalogIndex === 0
    ) {
      progress.statusOrder = await inferStatusOrder(archive, kind)
    }
    while (progress.catalogStage !== 'done') {
      const stage = progress.catalogStage
      const events = await listEventStream(archive, kind, stage)
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
      for await (const event of events) {
        if (event.index < progress.catalogIndex) continue
        nextIndex = event.index + 1
        if ('raw' in event) {
          let value: unknown
          try {
            value = parseJsonItem(event.raw)
          } catch {
            value = null
          }
          if (stage === 'statuses' && value !== null) {
            items.push({
              kind: 'status',
              sourceId: sourceIdForStatus(value, kind, event.index),
              position: statusPosition(event.index, progress.statusOrder),
              data: event.raw
            })
            for (const [attachmentIndex, attachment] of (kind === 'mastodon'
              ? statusAttachments(value, kind)
              : []
            ).entries()) {
              const sourceId = sourceIdForAttachment(attachment)
              if (sourceId) {
                items.push({
                  kind: 'media',
                  sourceId,
                  position:
                    ACCOUNT_IMPORT_MEDIA_POSITION +
                    event.index * ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS +
                    attachmentIndex
                })
              }
            }
          } else if (
            stage !== 'statuses' &&
            typeof value === 'string' &&
            value.length <= 512
          ) {
            items.push({
              kind: stage === 'likes' ? 'like' : 'bookmark',
              sourceId: value,
              position:
                (stage === 'likes'
                  ? ACCOUNT_IMPORT_LIKE_POSITION
                  : ACCOUNT_IMPORT_BOOKMARK_POSITION) + event.index,
              data: event.raw
            })
          }
        }
        if (items.length >= ACCOUNT_IMPORT_CATALOG_PAGE_SIZE) {
          await context.renew()
          await context.database.upsertAccountImportItems({
            importId: context.accountImport.id,
            actorId: context.accountImport.actorId,
            items
          })
          progress.totalItems += items.length
          items.length = 0
          progress.catalogIndex = nextIndex
          await context.renew()
          await context.database.updateAccountImport({
            id: context.accountImport.id,
            progress: serializeImportProgress(progress),
            cursor: JSON.stringify({ stage, index: nextIndex })
          })
          if (context.now() >= context.deadline)
            return {
              result: 'budget',
              progress,
              cursor: JSON.stringify({ stage, index: nextIndex })
            }
        }
      }
      if (items.length > 0) {
        await context.renew()
        await context.database.upsertAccountImportItems({
          importId: context.accountImport.id,
          actorId: context.accountImport.actorId,
          items
        })
        progress.totalItems += items.length
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
): CatalogStage =>
  stage === 'statuses' ? 'likes' : stage === 'likes' ? 'bookmarks' : 'done'

const accountImportItems = async (
  database: Database,
  importId: string
): Promise<AccountImportItem[]> => {
  const all: AccountImportItem[] = []
  let afterPosition: number | undefined
  for (;;) {
    const page = await database.getAccountImportItems({
      importId,
      ...(afterPosition === undefined ? {} : { afterPosition }),
      limit: 1000
    })
    all.push(...page)
    if (page.length < 1000) return all
    afterPosition = page[page.length - 1].position
  }
}

const parseCatalogedItem = (data: string | null): unknown => {
  if (data === null) return null
  try {
    return parseJsonItem(data)
  } catch {
    return null
  }
}

const readMediaMap = async (database: Database, importId: string) => {
  const media = new Map<string, string>()
  for (const item of await accountImportItems(database, importId)) {
    if (item.kind === 'media' && item.targetId)
      media.set(item.sourceId, item.targetId)
  }
  return media
}

const readTargetStatusMap = async (database: Database, importId: string) => {
  const statuses = new Map<string, string>()
  for (const item of await accountImportItems(database, importId)) {
    if (item.kind === 'status' && item.targetId)
      statuses.set(item.sourceId, item.targetId)
  }
  return statuses
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
      ) ?? null
  }))
})

const terminalItemState = async (
  context: AccountImportPhaseContext,
  progress: AccountImportProgress,
  item: AccountImportItem,
  state: 'done' | 'skipped',
  reason?: string,
  targetId?: string | null
) => {
  await context.renew()
  const marked = await context.database.markAccountImportItem({
    id: item.id,
    state,
    ...(reason ? { reason } : {}),
    ...(targetId !== undefined ? { targetId } : {})
  })
  if (!marked) throw new Error('import_item_missing')
  if (state === 'done') progress.completedItems += 1
  else progress.skippedItems += 1
  await context.renew()
  await context.database.updateAccountImport({
    id: context.accountImport.id,
    progress: serializeImportProgress(progress),
    cursor: serializeImportCursor(item.position)
  })
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
            if ((error as Error)?.message === 'import_actor_missing')
              throw error
            await terminalItemState(
              context,
              progress,
              item,
              'skipped',
              'media_invalid'
            )
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
  const completedAtStart = progress.completedItems + progress.skippedItems
  const actor = await requireActor(context)
  const allItems = await accountImportItems(
    context.database,
    context.accountImport.id
  )
  const statusItems = allItems.filter((item) => item.kind === 'status')
  const ownStatusIds = new Set(statusItems.map((item) => item.sourceId))
  const mediaByArchivePath = await readMediaMap(
    context.database,
    context.accountImport.id
  )
  const targetBySourceId = await readTargetStatusMap(
    context.database,
    context.accountImport.id
  )
  for (;;) {
    const page = await context.database.getAccountImportItems({
      importId: context.accountImport.id,
      ...(afterPosition === undefined ? {} : { afterPosition }),
      limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
    })
    if (page.length === 0) return { result: 'done', progress, cursor: null }
    for (const item of page) {
      if (await checkCancelled(context)) {
        return { result: 'cancelled', progress, cursor: null }
      }
      if (item.state === 'pending') {
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
      const remaining = (
        await accountImportItems(context.database, context.accountImport.id)
      ).filter((item) => item.kind === 'status' && item.state === 'pending')
      if (remaining.length > 0) {
        if (
          progress.completedItems + progress.skippedItems >
          completedAtStart
        ) {
          return { result: 'budget', progress, cursor: null }
        }
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
      return { result: 'done', progress, cursor: null }
    }
  }
}

// A single small JSON document of the archive (actor.json, profile.json, a
// settings row), read whole under a byte cap. The plan's "never parse a whole
// entry" rule is about the collections (outbox.json holds up to 200,000
// items); these documents are one bounded object each, and the cap keeps a
// padded one from costing more than the read itself.
const readArchiveJsonDocument = async (
  archive: ZipArchive,
  name: string,
  maxBytes: number
): Promise<unknown> => {
  if (!requiredEntry(archive.entries, name)) return null
  const stream = await archive.openEntryStream(name)
  const bytes = await readAsyncIterableToBufferWithLimit(
    chunksOf(stream),
    maxBytes,
    'Archived JSON document'
  )
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    return null
  }
}

// The same caps the profile route's PATCH applies to a name and a bio it did
// not already have stored (NAME_MAX_LENGTH / SUMMARY_MAX_LENGTH there).
const PROFILE_NAME_MAX_LENGTH = 255
const PROFILE_SUMMARY_MAX_LENGTH = 500
// The actor document cap of the inspect phase's scanner, reused so both reads
// of actor.json cost the same ceiling.
const PROFILE_ACTOR_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024
const SETTINGS_DOCUMENT_MAX_BYTES = 1024 * 1024

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
 * Saves one profile image from the archive's own bytes through the same media
 * path the profile routes use (MediaSchema, the image type check, the decode
 * check, saveMedia). The MIME type is sniffed from the bytes, never taken from
 * the entry name or the archive's claim; anything that is not a stored png or
 * jpeg is skipped, and so is a save the storage cannot take.
 */
const importProfileImage = async (
  context: AccountImportPhaseContext,
  archive: ZipArchive,
  actor: Actor,
  url: string | undefined,
  maxBytes: number
): Promise<string | null> => {
  const entryName = url ? profileImageEntryName(url, archive.entries) : null
  if (!entryName) return null
  const entry = archive.entries.find(
    (candidate) => candidate.name === entryName
  )
  if (!entry || entry.uncompressedSize > maxBytes) return null
  let bytes: Buffer
  try {
    const stream = await archive.openEntryStream(entryName)
    bytes = await readAsyncIterableToBufferWithLimit(
      chunksOf(stream),
      maxBytes,
      'Archived profile image'
    )
  } catch {
    return null
  }
  const mediaType = sniffSupportedMediaType(bytes)
  if (!mediaType || !ACCEPTED_IMAGE_TYPES.includes(mediaType)) return null
  const file = new File(
    [new Uint8Array(bytes)],
    sanitizeStoredFileName(basename(entryName)),
    { type: mediaType }
  )
  const parsed = MediaSchema.safeParse({ file })
  if (!parsed.success) return null
  try {
    await readValidThumbnail(file)
  } catch {
    return null
  }
  await context.renew()
  const saved = await saveMedia(context.database, actor, parsed.data)
  return saved ? saved.url : null
}

export interface ProfileSettingsPhaseResult {
  result: PhaseResult
  progress: AccountImportProgress
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
    const document = await readArchiveJsonDocument(
      archive,
      'actor.json',
      PROFILE_ACTOR_DOCUMENT_MAX_BYTES
    )
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
    const iconUrl = await importProfileImage(
      context,
      archive,
      actor,
      source.icon?.url,
      media.maxFileSize
    )
    if (iconUrl) patch.iconUrl = iconUrl
    const headerImageUrl = await importProfileImage(
      context,
      archive,
      actor,
      source.image?.url,
      media.maxFileSize
    )
    if (headerImageUrl) patch.headerImageUrl = headerImageUrl
    if (Object.keys(patch).length === 0) return { result: 'done', progress }
    await context.renew()
    const { before, after } = await context.database.updateActorWithPrevious({
      actorId: context.accountImport.actorId,
      ...patch
    })
    // The one federated side effect the importer is allowed: a single
    // Update(Person), and only for a change to what the Person carries.
    if (after && (!before || hasFederatedProfileChange(before, after))) {
      await publishActorUpdate({ actorId: context.accountImport.actorId })
    }
    return { result: 'done', progress }
  } finally {
    await archive.close()
  }
}

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
    const profileDocument = await readArchiveJsonDocument(
      archive,
      'activities.next/profile.json',
      SETTINGS_DOCUMENT_MAX_BYTES
    )
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
    const galleryRow = await readArchiveJsonDocument(
      archive,
      'activities.next/gallery/settings.json',
      SETTINGS_DOCUMENT_MAX_BYTES
    )
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

export const runGearsNoopPhase = async () => 'done' as const
export const runOwnArchiveMediaNoopPhase = async () => 'done' as const
export const runGalleryNoopPhase = async () => 'done' as const
export const runFitnessNoopPhase = async () => 'done' as const
export const runAlbumsNoopPhase = async () => 'done' as const
export const runCollectionsNoopPhase = async () => 'done' as const

export const sourceIndexFromPosition = statusIndex

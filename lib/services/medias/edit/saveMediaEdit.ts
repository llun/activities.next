import sharp from 'sharp'

import type {
  ApplyMediaEditResult,
  MediaEditState
} from '@/lib/database/domains/mediaEdit/types'
import { Database } from '@/lib/database/types'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { deleteMediaFile, getMediaStorage } from '@/lib/services/medias'
import {
  MEDIA_NOT_EDITABLE_ERROR,
  isEditableMedia
} from '@/lib/services/medias/edit/editable'
import { Size, getRecipeOutputSize } from '@/lib/services/medias/edit/geometry'
import {
  Recipe,
  isNeutralRecipe,
  normalizeRecipe,
  parseRecipe,
  parseStoredRecipe
} from '@/lib/services/medias/edit/recipe'
import {
  getOwnedMediaPosts,
  refreshPostsForEditedMedia
} from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import { checkQuotaAvailable } from '@/lib/services/medias/quota'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// The stored file the editor starts from is read whole to learn its pixel
// size; a presigned S3 upload is the client's own bytes, so the cap is high.
export const EDIT_SOURCE_MAX_BYTES = 100 * 1024 * 1024
// A render is at most 4000 px on its long edge; 40 MiB is far above any
// JPEG or PNG of that size and still bounds what a client can make us store.
export const EDIT_RENDER_MAX_BYTES = 40 * 1024 * 1024
export const EDIT_RENDER_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png'
]
// The client rounds the output size; allow it to be off by a pixel or two.
const SIZE_TOLERANCE_PX = 2

const EDITS_PER_HOUR = 60
const editSaves = createWindowCounter({
  limit: EDITS_PER_HOUR,
  windowMs: 60 * 60 * 1000
})

export const ERROR_RECORD_NOT_FOUND = 'Record not found'
export const ERROR_TOO_MANY_EDITS = 'Too many edits. Try again later.'
export const ERROR_SIZE_MISMATCH = 'Edited image size does not match the recipe'
export const ERROR_NO_STORAGE = 'Not enough storage left for the edited photo'
export const ERROR_NOTHING_TO_REVERT = 'Nothing to revert'
export const ERROR_APPLY_TO_POSTS_REQUIRED =
  'Choose whether to update the posts that use this photo'
export const ERROR_NEUTRAL_RECIPE =
  'The recipe changes nothing; revert the photo instead'
export const ERROR_RENDER_TYPE = 'The edited image must be a JPEG or PNG'

export type ApplyToPosts = 'update' | 'gallery'

export interface MediaEditEntity {
  version: number
  recipe: Recipe | null
  editedAt: string | null
  saveId: string | null
  source: { width: number; height: number; mimeType: string }
  masks: { id: string; url: string }[]
}

export interface MediaEditUsage {
  statusCount: number
  latestStatusAt: string | null
}

export interface MediaEditResponse {
  media: MediaStorageSaveFileOutput
  edit: MediaEditEntity
  usage: MediaEditUsage
  capabilities: {
    subjectModel: null
    enhance: { available: boolean; model: string | null }
  }
}

export interface MediaEditWriteResponse extends MediaEditResponse {
  posts: { updated: string[]; skipped: string[] }
}

export type MediaEditErrorBody = {
  error: string
  edit?: { version: number; saveId: string | null }
}

export type MediaEditResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: 404 | 409 | 413 | 422 | 429; body: MediaEditErrorBody }

const fail = (
  status: 404 | 409 | 413 | 422 | 429,
  error: string
): { ok: false; status: typeof status; body: MediaEditErrorBody } => ({
  ok: false,
  status,
  body: { error }
})

const notFound = () => fail(404, ERROR_RECORD_NOT_FOUND)
const notEditable = () => fail(422, MEDIA_NOT_EDITABLE_ERROR)
const stale = (version: number, saveId: string | null) => ({
  ok: false as const,
  status: 409 as const,
  body: { error: 'stale', edit: { version, saveId } }
})

const toIso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString()

/** The stored file the editor renders from: the uploaded original. */
export const getEditSourcePath = (
  media: Pick<Media, 'original'>,
  state: Pick<MediaEditState, 'original'> | null
) => state?.original?.path ?? media.original.path

interface EditSource {
  buffer: Buffer
  mimeType: string
  size: Size
  // The size once the file's EXIF orientation is applied, when that differs.
  // Stored renditions carry no EXIF; a presigned upload is the client's own
  // bytes and may.
  orientedSize: Size | null
}

/**
 * Reads the source and decodes its pixel size. `medias.original.metaData`
 * cannot be trusted for this: it describes the file as it was uploaded, before
 * the stored rendition was fitted inside 4000 px. Null when the file is
 * missing, too large or not an image.
 */
export const readEditSource = async (
  database: Database,
  path: string
): Promise<EditSource | null> => {
  try {
    const stored = await readStoredImage(database, path, EDIT_SOURCE_MAX_BYTES)
    if (!stored) return null
    const { width, height, orientation } = await sharp(stored.buffer).metadata()
    if (!width || !height) return null
    return {
      buffer: stored.buffer,
      mimeType: stored.mimeType,
      size: { width, height },
      orientedSize:
        orientation && orientation >= 5
          ? { width: height, height: width }
          : null
    }
  } catch (e) {
    logger.warn({
      message: 'Failed to read the source of a photo edit',
      err: toLoggableError(e),
      path
    })
    return null
  }
}

/**
 * The account's posts that show the media: how many, and when the newest was
 * written. Only Notes of the media owner's account count.
 */
export const getMediaEditUsage = async ({
  database,
  mediaId,
  accountId
}: {
  database: Database
  mediaId: string
  accountId: string
}): Promise<MediaEditUsage & { statusIds: string[] }> => {
  const found = await database.getMediaWithAttachedStatusIds({ mediaId })
  const statusIds = found?.statusIds ?? []
  const { posts } = await getOwnedMediaPosts({
    database,
    statusIds,
    accountId
  })
  const latest = posts.reduce<number | null>(
    (newest, { status }) =>
      newest === null || status.createdAt > newest ? status.createdAt : newest,
    null
  )
  return {
    statusCount: posts.length,
    latestStatusAt: toIso(latest),
    statusIds
  }
}

const buildEditEntity = (
  media: Media,
  state: MediaEditState | null,
  source: Pick<EditSource, 'size' | 'mimeType'> | null
): MediaEditEntity => {
  let recipe: Recipe | null = null
  if (state?.recipe) {
    recipe = parseStoredRecipe(state.recipe)
    if (!recipe) {
      logger.warn({
        message: 'Stored photo edit recipe could not be parsed',
        mediaId: media.id
      })
    }
  }

  // After a write the source is the file the request already decoded; if it
  // could not be read, fall back to what the rows record about it.
  const original = state?.original
  const fallbackWidth = Number(
    original?.metaData.width ?? media.original.metaData.width ?? 0
  )
  const fallbackHeight = Number(
    original?.metaData.height ?? media.original.metaData.height ?? 0
  )
  return {
    version: state?.version ?? 0,
    recipe,
    editedAt: toIso(state?.editedAt ?? null),
    saveId: state?.saveId ?? null,
    source: source
      ? { ...source.size, mimeType: source.mimeType }
      : {
          width: fallbackWidth,
          height: fallbackHeight,
          mimeType: original?.mimeType ?? media.original.mimeType
        },
    // Phase 2 fills these in.
    masks: []
  }
}

const buildResponse = async ({
  database,
  media,
  state,
  source,
  usage,
  host
}: {
  database: Database
  media: Media
  state: MediaEditState | null
  source: Pick<EditSource, 'size' | 'mimeType'> | null
  usage: MediaEditUsage
  host: string
}): Promise<MediaEditResponse> => ({
  media: await getOwnerMediaAttachment(database, media, host),
  edit: buildEditEntity(media, state, source),
  usage: {
    statusCount: usage.statusCount,
    latestStatusAt: usage.latestStatusAt
  },
  capabilities: {
    subjectModel: null,
    enhance: { available: false, model: null }
  }
})

// Deletes stored files after the commit. A failure leaves an orphan for the
// storage cleanup script and never fails the request.
const deleteFilesBestEffort = async (database: Database, paths: string[]) => {
  await Promise.all(
    paths.map(async (path) => {
      try {
        const removed = await deleteMediaFile(database, path)
        if (!removed) {
          logger.warn({ message: 'Failed to delete a photo edit file', path })
        }
      } catch (e) {
        logger.warn({
          message: 'Failed to delete a photo edit file',
          err: toLoggableError(e),
          path
        })
      }
    })
  )
}

/** GET /api/v1/media/:id/edit */
export const getMediaEdit = async ({
  database,
  mediaId,
  accountId,
  host
}: {
  database: Database
  mediaId: string
  accountId: string
  host: string
}): Promise<MediaEditResult<MediaEditResponse>> => {
  const media = await database.getMediaByIdForAccount({ mediaId, accountId })
  if (!media) return notFound()
  if (!isEditableMedia(media)) return notEditable()

  const state = await database.getMediaEditState({ mediaId: media.id })
  const source = await readEditSource(database, getEditSourcePath(media, state))
  if (!source) return notEditable()

  const usage = await getMediaEditUsage({
    database,
    mediaId: media.id,
    accountId
  })
  return {
    ok: true,
    body: await buildResponse({
      database,
      media,
      state,
      source,
      usage,
      host
    })
  }
}

/**
 * The bytes of the editor's source, for GET /api/v1/media/:id/edit/source.
 */
export const getMediaEditSource = async ({
  database,
  mediaId,
  accountId
}: {
  database: Database
  mediaId: string
  accountId: string
}): Promise<MediaEditResult<{ buffer: Buffer; mimeType: string }>> => {
  const media = await database.getMediaByIdForAccount({ mediaId, accountId })
  if (!media) return notFound()
  if (!isEditableMedia(media)) return notEditable()

  const state = await database.getMediaEditState({ mediaId: media.id })
  const path = getEditSourcePath(media, state)
  try {
    const stored = await readStoredImage(database, path, EDIT_SOURCE_MAX_BYTES)
    if (!stored) return notEditable()
    return { ok: true, body: stored }
  } catch (e) {
    logger.warn({
      message: 'Failed to read the source of a photo edit',
      err: toLoggableError(e),
      path
    })
    return notEditable()
  }
}

/**
 * Steps 7–9 of a save or revert, once the write committed: delete the files
 * it released, update the posts when asked, and prune superseded renders no
 * post can still show.
 */
const afterWrite = async ({
  database,
  media,
  accountId,
  removedPaths,
  statusIds,
  applyToPosts
}: {
  database: Database
  media: Media
  accountId: string
  removedPaths: string[]
  statusIds: string[]
  applyToPosts: ApplyToPosts | undefined
}) => {
  await deleteFilesBestEffort(database, removedPaths)

  const posts =
    statusIds.length > 0 && applyToPosts === 'update'
      ? await refreshPostsForEditedMedia({ database, media, accountId })
      : { updated: [], skipped: [] }

  // "Gallery only" keeps the superseded renders: its posts still show them.
  const prune =
    statusIds.length === 0 ||
    (applyToPosts === 'update' && posts.skipped.length === 0)
  if (prune) {
    const pruned = await database.pruneSupersededMediaEditFiles({
      mediaId: media.id,
      accountId
    })
    await deleteFilesBestEffort(database, pruned)
  }
  return posts
}

const finishWrite = async ({
  database,
  result,
  accountId,
  source,
  usage,
  applyToPosts,
  host
}: {
  database: Database
  result: Extract<ApplyMediaEditResult, { status: 'ok' }>
  accountId: string
  source: Pick<EditSource, 'size' | 'mimeType'> | null
  usage: MediaEditUsage & { statusIds: string[] }
  applyToPosts: ApplyToPosts | undefined
  host: string
}): Promise<MediaEditWriteResponse> => {
  const posts = await afterWrite({
    database,
    media: result.media,
    accountId,
    removedPaths: result.removedPaths,
    statusIds: usage.statusIds,
    applyToPosts
  })
  const state = await database.getMediaEditState({ mediaId: result.media.id })
  const response = await buildResponse({
    database,
    media: result.media,
    state,
    source,
    // The refresh does not change which posts use the media or when they
    // were written, so the usage read before the write still holds.
    usage,
    host
  })
  return { ...response, posts }
}

export interface SaveMediaEditInput {
  database: Database
  actor: Actor
  accountId: string
  mediaId: string
  host: string
  file: { buffer: Buffer; size: number }
  recipe: string
  baseVersion: number
  saveId: string
  applyToPosts?: ApplyToPosts
  focus?: { x: number; y: number }
}

const matchesSize = (actual: Size, expected: Size) =>
  Math.abs(actual.width - expected.width) <= SIZE_TOLERANCE_PX &&
  Math.abs(actual.height - expected.height) <= SIZE_TOLERANCE_PX

const isIdentityGeometry = (recipe: Recipe) => {
  const { geometry } = recipe
  const { crop } = geometry
  return (
    geometry.rotate90 === 0 &&
    !geometry.flipH &&
    geometry.straighten === 0 &&
    crop.x <= 1e-6 &&
    crop.y <= 1e-6 &&
    crop.width >= 1 - 1e-6 &&
    crop.height >= 1 - 1e-6
  )
}

/**
 * The focal point the render is stored with. A focus the client sent wins.
 * Otherwise the uploaded photo's focus is kept when the recipe leaves the
 * frame as it was (no crop, turn, flip or straighten): the point still marks
 * the same pixels. A recipe that moves the frame has its focus computed
 * again from the render. (There is no record of whether a focus was set by
 * hand, so the frame is what decides.)
 */
const getRenderFocus = (
  media: Media,
  state: MediaEditState | null,
  recipe: Recipe,
  focus: SaveMediaEditInput['focus']
) => {
  if (focus) return focus
  if (!isIdentityGeometry(recipe)) return undefined
  const originalFocus = state?.original
    ? state.original.metaData.focus
    : media.focus
  return originalFocus ?? undefined
}

/** POST /api/v1/media/:id/edit (service `saveMediaEdit`, spec §4.3). */
export const saveMediaEdit = async ({
  database,
  actor,
  accountId,
  mediaId,
  host,
  file,
  recipe: rawRecipe,
  baseVersion,
  saveId,
  applyToPosts,
  focus
}: SaveMediaEditInput): Promise<MediaEditResult<MediaEditWriteResponse>> => {
  if (!editSaves.tryHit(actor.id)) return fail(429, ERROR_TOO_MANY_EDITS)

  const media = await database.getMediaByIdForAccount({ mediaId, accountId })
  if (!media) return notFound()
  if (!isEditableMedia(media)) return notEditable()

  const parsed = parseRecipe(rawRecipe)
  if (!parsed.ok) return fail(422, parsed.error)
  const recipe = normalizeRecipe(parsed.recipe)
  if (isNeutralRecipe(recipe)) return fail(422, ERROR_NEUTRAL_RECIPE)

  const state = await database.getMediaEditState({ mediaId: media.id })
  if (!state) return notFound()
  if (state.version !== baseVersion) return stale(state.version, state.saveId)

  const usage = await getMediaEditUsage({
    database,
    mediaId: media.id,
    accountId
  })
  if (usage.statusCount > 0 && !applyToPosts) {
    return fail(422, ERROR_APPLY_TO_POSTS_REQUIRED)
  }
  const choice = usage.statusCount > 0 ? applyToPosts : undefined

  const source = await readEditSource(database, getEditSourcePath(media, state))
  if (!source) return notEditable()

  let renderSize: Size
  try {
    const metadata = await sharp(file.buffer).metadata()
    if (
      !metadata.width ||
      !metadata.height ||
      !['jpeg', 'png'].includes(metadata.format ?? '')
    ) {
      return fail(422, ERROR_RENDER_TYPE)
    }
    renderSize = { width: metadata.width, height: metadata.height }
  } catch {
    return fail(422, ERROR_RENDER_TYPE)
  }
  const expectedSizes = [source.size, source.orientedSize]
    .filter((size): size is Size => size !== null)
    .map((size) => getRecipeOutputSize(size, recipe))
  if (!expectedSizes.some((expected) => matchesSize(renderSize, expected))) {
    return fail(422, ERROR_SIZE_MISMATCH)
  }

  const quota = await checkQuotaAvailable(database, actor, file.size)
  if (!quota.available) return fail(413, ERROR_NO_STORAGE)

  const storage = getMediaStorage(database)
  if (!storage) throw new Error('Media storage is not configured')
  const render = await storage.saveEditedImage({
    actor,
    buffer: file.buffer,
    manualFocus: getRenderFocus(media, state, recipe, focus)
  })

  let result: ApplyMediaEditResult
  try {
    result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion,
      saveId,
      recipe: JSON.stringify(recipe),
      render
    })
  } catch (e) {
    await deleteFilesBestEffort(database, [render.path])
    throw e
  }

  if (result.status !== 'ok') {
    // Nothing references the render: delete it right away.
    await deleteFilesBestEffort(database, [render.path])
    if (result.status === 'stale') return stale(result.version, result.saveId)
    return notFound()
  }

  logger.info({
    message: 'Photo edit saved',
    mediaId: media.id,
    accountId,
    version: result.version
  })

  return {
    ok: true,
    body: await finishWrite({
      database,
      result,
      accountId,
      source,
      usage,
      applyToPosts: choice,
      host
    })
  }
}

export interface RevertMediaEditInput {
  database: Database
  accountId: string
  mediaId: string
  host: string
  baseVersion: number
  saveId: string
  applyToPosts?: ApplyToPosts
}

/** POST /api/v1/media/:id/edit/revert (spec §4.4). */
export const revertMediaEdit = async ({
  database,
  accountId,
  mediaId,
  host,
  baseVersion,
  saveId,
  applyToPosts
}: RevertMediaEditInput): Promise<MediaEditResult<MediaEditWriteResponse>> => {
  const media = await database.getMediaByIdForAccount({ mediaId, accountId })
  if (!media) return notFound()

  // The same early checks the write repeats under its row lock, so a retry
  // or a stale tab learns what happened before the posts question is asked.
  const state = await database.getMediaEditState({ mediaId: media.id })
  if (!state) return notFound()
  if (state.version !== baseVersion) return stale(state.version, state.saveId)
  if (!state.original) return fail(409, ERROR_NOTHING_TO_REVERT)

  const usage = await getMediaEditUsage({
    database,
    mediaId: media.id,
    accountId
  })
  if (usage.statusCount > 0 && !applyToPosts) {
    return fail(422, ERROR_APPLY_TO_POSTS_REQUIRED)
  }

  const result = await database.revertMediaEdit({
    mediaId: media.id,
    accountId,
    baseVersion,
    saveId
  })
  if (result.status === 'not-found') return notFound()
  if (result.status === 'stale') return stale(result.version, result.saveId)
  if (result.status === 'not-edited') return fail(409, ERROR_NOTHING_TO_REVERT)

  logger.info({
    message: 'Photo edit reverted',
    mediaId: media.id,
    accountId,
    version: result.version
  })

  // The live file is the source again.
  const source = await readEditSource(database, result.media.original.path)
  return {
    ok: true,
    body: await finishWrite({
      database,
      result,
      accountId,
      source,
      usage,
      applyToPosts: usage.statusCount > 0 ? applyToPosts : undefined,
      host
    })
  }
}

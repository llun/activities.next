// Parameter and result types of the photo edit domain (`media_edit_files` and
// the `edit*` columns of `medias`).
import type { Media } from '@/lib/types/database/operations'

export const MEDIA_EDIT_ORIGINAL_SLOT = 'original'
export const MEDIA_EDIT_SUPERSEDED_PREFIX = 'superseded:'
export const MEDIA_EDIT_MASK_PREFIX = 'mask:'

/**
 * What a `media_edit_files` row records about its file.
 *
 * - `original` slot: the media's full `original.metaData` from before the first
 *   edit (including `upload.clientPath`), plus the row's `blurhash` and
 *   `focus` as they were, so a revert restores every one of them.
 * - `superseded:*` and `mask:*` slots: `{ width, height }`.
 */
export type MediaEditFileMeta = {
  width?: number
  height?: number
  blurhash?: string | null
  focus?: { x: number; y: number } | null
  upload?: Media['original']['metaData']['upload']
  [key: string]: unknown
}

export type MediaEditFile = {
  id: string
  mediaId: string
  actorId: string
  slot: string
  path: string
  bytes: number
  mimeType: string
  metaData: MediaEditFileMeta
  createdAt: number
}

export type MediaEditState = {
  version: number
  /** The stored recipe JSON, exactly as validated; parse it with parseStoredRecipe. */
  recipe: string | null
  editedAt: number | null
  saveId: string | null
  /** The file the photo was uploaded as; null when the photo is unedited. */
  original: MediaEditFile | null
  masks: MediaEditFile[]
}

export type GetMediaEditStateParams = { mediaId: string }
export type ListMediaEditFilesParams = { mediaIds: string[] }
export type GetMediaEditFilePathsParams = { mediaIds: string[] }

/** A stored render of the recipe, as `saveEditedImage` returns it. */
export type MediaEditRender = {
  path: string
  bytes: number
  mimeType: string
  width: number
  height: number
  blurhash: string | null
  focus: { x: number; y: number } | null
}

export type ApplyMediaEditParams = {
  mediaId: string
  accountId: string
  baseVersion: number
  saveId: string
  /** The validated recipe JSON. */
  recipe: string
  render: MediaEditRender
}

export type RevertMediaEditParams = {
  mediaId: string
  accountId: string
  baseVersion: number
  saveId: string
}

export type ApplyMediaEditResult =
  | {
      status: 'ok'
      media: Media
      version: number
      /** Stored files the write released; delete them after the commit. */
      removedPaths: string[]
    }
  | { status: 'not-found' }
  | { status: 'stale'; version: number; saveId: string | null }
  | { status: 'not-edited' }

export type PruneSupersededMediaEditFilesParams = {
  mediaId: string
  accountId: string
  /**
   * The edit version the caller's write produced. Nothing is pruned once the
   * media has moved past it: a later save or revert owns the renders then
   * (its posts may still show the one this write made).
   */
  version: number
}

export interface MediaEditDatabase {
  getMediaEditState(
    params: GetMediaEditStateParams
  ): Promise<MediaEditState | null>
  listMediaEditFiles(params: ListMediaEditFilesParams): Promise<MediaEditFile[]>
  // Every stored path the media's edits keep: each slot's file, plus the
  // original slot's `upload.clientPath` when it differs from its path.
  getMediaEditFilePaths(params: GetMediaEditFilePathsParams): Promise<string[]>
  applyMediaEdit(params: ApplyMediaEditParams): Promise<ApplyMediaEditResult>
  revertMediaEdit(params: RevertMediaEditParams): Promise<ApplyMediaEditResult>
  // Removes every superseded render and returns their paths, unless the media
  // has moved past `version`; the caller deletes the files after the commit.
  pruneSupersededMediaEditFiles(
    params: PruneSupersededMediaEditFilesParams
  ): Promise<string[]>
}

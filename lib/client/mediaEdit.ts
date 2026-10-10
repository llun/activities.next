import type { Recipe } from '@/lib/services/medias/edit/recipe'
import type { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'

/** What `GET /api/v1/media/:id/edit` says about the media's saved edit. */
export interface MediaEditInfo {
  version: number
  recipe: Recipe | null
  editedAt: string | null
  saveId: string | null
  source: { width: number; height: number; mimeType: string }
  /** Phase 2; always empty in phase 1. */
  masks: { id: string; url: string }[]
}

export interface MediaEditUsage {
  statusCount: number
  latestStatusAt: string | null
}

export interface MediaEditCapabilities {
  subjectModel: unknown | null
  enhance: { available: boolean; model: string | null }
}

export interface MediaEditState {
  media: MediaStorageSaveFileOutput
  edit: MediaEditInfo
  usage: MediaEditUsage
  capabilities?: MediaEditCapabilities
}

export type ApplyToPosts = 'update' | 'gallery'

export interface MediaEditSaveResult extends MediaEditState {
  posts: { updated: string[]; skipped: string[] }
}

/**
 * A failed edit request. `status` is the HTTP status, `error` the server's
 * message, and `edit` is set on a 409 `stale` answer so the caller can tell its
 * own retried save from someone else's.
 */
export class MediaEditError extends Error {
  status: number
  error: string
  edit?: { version: number; saveId: string | null }

  constructor(
    status: number,
    error: string,
    edit?: { version: number; saveId: string | null }
  ) {
    super(error)
    this.name = 'MediaEditError'
    this.status = status
    this.error = error
    this.edit = edit
  }
}

const editPath = (id: string) => `/api/v1/media/${encodeURIComponent(id)}/edit`

const toError = async (response: Response, fallback: string) => {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
    edit?: { version?: unknown; saveId?: unknown }
  } | null
  const message =
    typeof body?.error === 'string' && body.error ? body.error : fallback
  const edit =
    body?.edit && typeof body.edit.version === 'number'
      ? {
          version: body.edit.version,
          saveId: typeof body.edit.saveId === 'string' ? body.edit.saveId : null
        }
      : undefined
  return new MediaEditError(response.status, message, edit)
}

/** The owner's media, its saved recipe, and how many posts use it. */
export const getMediaEdit = async (id: string): Promise<MediaEditState> => {
  const response = await fetch(editPath(id), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw await toError(response, 'Failed to load the photo.')
  return response.json()
}

/**
 * Same-origin URL of the unedited original's bytes. The editor fetches it with
 * credentials, so the canvas is never tainted by a CDN origin.
 */
export const getMediaEditSourceUrl = (id: string) => `${editPath(id)}/source`

export interface SaveMediaEditParams {
  blob: Blob
  recipe: Recipe
  baseVersion: number
  /** A fresh UUID per Save click; reuse it when retrying the same save. */
  saveId: string
  /** Required by the server when the media is in posts. */
  applyToPosts?: ApplyToPosts
  focus?: { x: number; y: number }
}

/** Uploads the rendered photo and the recipe that produced it. */
export const saveMediaEdit = async (
  id: string,
  {
    blob,
    recipe,
    baseVersion,
    saveId,
    applyToPosts,
    focus
  }: SaveMediaEditParams
): Promise<MediaEditSaveResult> => {
  const form = new FormData()
  form.append('file', blob, blob.type === 'image/png' ? 'edit.png' : 'edit.jpg')
  form.append('recipe', JSON.stringify(recipe))
  form.append('base_version', String(baseVersion))
  form.append('save_id', saveId)
  if (applyToPosts) form.append('apply_to_posts', applyToPosts)
  if (focus) form.append('focus', `${focus.x},${focus.y}`)
  const response = await fetch(editPath(id), { method: 'POST', body: form })
  if (!response.ok) throw await toError(response, 'Failed to save the photo.')
  return response.json()
}

export interface RevertMediaEditParams {
  baseVersion: number
  saveId: string
  applyToPosts?: ApplyToPosts
}

/** Puts the original back. */
export const revertMediaEdit = async (
  id: string,
  { baseVersion, saveId, applyToPosts }: RevertMediaEditParams
): Promise<MediaEditSaveResult> => {
  const response = await fetch(`${editPath(id)}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      base_version: baseVersion,
      save_id: saveId,
      ...(applyToPosts ? { apply_to_posts: applyToPosts } : {})
    })
  })
  if (!response.ok) {
    throw await toError(response, 'Failed to revert the photo.')
  }
  return response.json()
}

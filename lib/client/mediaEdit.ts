import type { Recipe } from '@/lib/services/medias/edit/recipe'
import type {
  ApplyToPosts,
  MediaEditEntity,
  MediaEditResponse,
  MediaEditUsage,
  MediaEditWriteResponse
} from '@/lib/services/medias/edit/saveMediaEdit'

// The response shapes are the server's own, so a route change breaks the build
// here instead of at runtime. These are type-only imports.
export type { ApplyToPosts, MediaEditEntity as MediaEditInfo, MediaEditUsage }

/**
 * The subject model the server offers (`capabilities.subjectModel`): where to
 * fetch the two ONNX files and the size and sha256 each must have. Null when
 * the instance turned Select subject off.
 */
export interface SubjectModelCapability {
  /** Ends with "/". */
  baseUrl: string
  files: {
    encoder: { path: string; bytes: number; sha256: string }
    decoder: { path: string; bytes: number; sha256: string }
  }
}

type WithSubjectModel<T extends { capabilities: object }> = Omit<
  T,
  'capabilities'
> & {
  capabilities: Omit<T['capabilities'], 'subjectModel'> & {
    subjectModel: SubjectModelCapability | null
  }
}

/** What `GET /api/v1/media/:id/edit` answers. */
export type MediaEditState = WithSubjectModel<MediaEditResponse>

/** What a save or revert answers: the state plus the posts it touched. */
export type MediaEditSaveResult = WithSubjectModel<MediaEditWriteResponse>

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
  /** PNG of each new or changed mask by mask id, sent as `mask_<id>` parts. */
  masks?: Record<string, Blob>
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
    focus,
    masks
  }: SaveMediaEditParams
): Promise<MediaEditSaveResult> => {
  const form = new FormData()
  form.append('file', blob, blob.type === 'image/png' ? 'edit.png' : 'edit.jpg')
  form.append('recipe', JSON.stringify(recipe))
  form.append('base_version', String(baseVersion))
  form.append('save_id', saveId)
  if (applyToPosts) form.append('apply_to_posts', applyToPosts)
  if (focus) form.append('focus', `${focus.x},${focus.y}`)
  for (const [maskId, png] of Object.entries(masks ?? {})) {
    form.append(`mask_${maskId}`, png, `mask_${maskId}.png`)
  }
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

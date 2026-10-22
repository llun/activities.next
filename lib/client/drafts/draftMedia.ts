import { deleteUnpostedFitnessFile } from '@/lib/client/fitnessRoutes'
import { deleteUnpostedMedia } from '@/lib/client/media'

import { deleteDraftIfRevision } from './draftsDb'
import type { DraftBlobRecord, DraftRecord } from './types'

/** Rebuilds the `File` a composer uploads from the stored bytes. */
export const blobRecordToFile = (blob: DraftBlobRecord): File =>
  new File([blob.bytes], blob.fileName, {
    type: blob.mimeType,
    lastModified: blob.lastModified
  })

/** A poster frame (video) rebuilt as a `File`, when the blob has one. */
export const blobRecordToPosterFile = (
  blob: DraftBlobRecord
): File | undefined =>
  blob.poster
    ? new File([blob.poster.bytes], blob.poster.fileName, {
        type: blob.poster.mimeType
      })
    : undefined

/**
 * Bytes are stored as `ArrayBuffer` + MIME type, never a live `File` or `Blob`
 * (WebKit's Blob-in-IndexedDB bug).
 */
export const fileToBlobRecord = async ({
  id,
  draftId,
  file,
  poster
}: {
  id: string
  draftId: string
  file: File
  poster?: File
}): Promise<Omit<DraftBlobRecord, 'accountId'>> => ({
  id,
  draftId,
  bytes: await file.arrayBuffer(),
  mimeType: file.type,
  fileName: file.name,
  lastModified: file.lastModified,
  poster: poster
    ? {
        bytes: await poster.arrayBuffer(),
        mimeType: poster.type,
        fileName: poster.name
      }
    : undefined
})

/**
 * Deletes the draft record first (one transaction that checks `draft.revision`,
 * blobs included), then, best effort and in parallel, the server-side uploads
 * the record that transaction actually deleted owns. The caller's `draft` is
 * only a snapshot: a draft already gone deletes no media, and a revision
 * mismatch rejects with `DraftConflictError`, also with no media deletion.
 * The uploads:
 * - `deleteUnpostedMedia` for owned media (a 422 means a status uses it);
 * - `deleteUnpostedFitnessFile` only when the draft owns the file and never
 *   attempted a create (a 422 keeps a file a post uses, such as one another
 *   tab sent).
 * It never calls `deleteAccountMedia`. A locked draft's attachments are
 * `owned: false`, so discarding one deletes no media. Offline, the media stays
 * in the author's Gallery, where it is visible and deletable.
 */
export const deleteDraftAndOwnedMedia = async (
  draft: DraftRecord
): Promise<void> => {
  const deleted = await deleteDraftIfRevision(draft.id, draft.revision)
  if (!deleted) return

  const deletions: Promise<unknown>[] = []
  for (const attachment of deleted.attachments) {
    if (attachment.owned && attachment.mediaId) {
      deletions.push(deleteUnpostedMedia(attachment.mediaId))
    }
  }
  const fitnessFile = deleted.fitnessFile
  if (fitnessFile?.owned && fitnessFile.fitnessFileId && !deleted.attemptedAt) {
    deletions.push(deleteUnpostedFitnessFile(fitnessFile.fitnessFileId))
  }
  // A courtesy step: the draft is already gone, so a failure only orphans.
  await Promise.allSettled(deletions)
}

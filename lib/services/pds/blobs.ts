import { type TypedBlobRef, cidForRawBytes } from '@atproto/lex-data'
import { isValidDid } from '@atproto/syntax'
import { Readable } from 'node:stream'

import type { PdsBlob } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'

import {
  PDS_BLOB_REPO_LOCK_TTL_MS,
  type PdsBlobObjectStore,
  getPdsBlobStorageKey,
  resolvePdsBlobObjectStore
} from './blobStorage'
import { MAX_PDS_BLOB_SIZE_BYTES, MAX_PDS_DID_LENGTH } from './constants'
import { PdsBlobTooLargeError, PdsValidationError } from './errors'
import { withPdsRepoLock } from './lock'
import { assertPdsRepoAvailable } from './reads'

const MAX_PDS_BLOB_MIME_TYPE_LENGTH = 255
// RFC 6838 restricted token pattern: bare `type/subtype`, no parameters or whitespace.
const PDS_BLOB_MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

export type UploadPdsBlobInput = {
  did: string
  bytes: Uint8Array | Buffer
  mimeType: string
}

export type UploadPdsBlobResult = {
  cid: string
  mimeType: string
  size: number
  storageKey: string
  blob: TypedBlobRef
}

const toUploadResult = (
  row: PdsBlob,
  cid: Awaited<ReturnType<typeof cidForRawBytes>>
): UploadPdsBlobResult => ({
  cid: row.cid,
  mimeType: row.mimeType,
  size: row.size,
  storageKey: row.storageKey,
  blob: {
    $type: 'blob',
    ref: cid,
    mimeType: row.mimeType,
    size: row.size
  }
})

/**
 * Computes the raw sha256 CID over the exact bytes, stores them byte-for-byte
 * under `pds-blobs/<HMAC-SHA256(key, did)>/<cid>.<random>` without re-encoding,
 * and registers the `pds_blobs` row.
 *
 * Each upload writes its own unique key, so a delete that names the key of a
 * removed row can never remove a newer upload of the same bytes. If the row for
 * `(did, cid)` already exists, the existing row is returned and no file is
 * written.
 */
export const uploadPdsBlob = async (
  database: Database,
  { did, bytes, mimeType }: UploadPdsBlobInput,
  options: { store?: PdsBlobObjectStore } = {}
): Promise<UploadPdsBlobResult> => {
  if (did.length > MAX_PDS_DID_LENGTH || !isValidDid(did)) {
    throw new PdsValidationError(`Invalid DID: ${did}`)
  }

  const normalizedMime = mimeType.trim().toLowerCase()
  if (
    !normalizedMime ||
    normalizedMime.length > MAX_PDS_BLOB_MIME_TYPE_LENGTH ||
    !PDS_BLOB_MIME_TYPE_PATTERN.test(normalizedMime)
  ) {
    throw new PdsValidationError(`Invalid blob mimeType: ${mimeType}`)
  }

  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (buffer.byteLength > MAX_PDS_BLOB_SIZE_BYTES) {
    throw new PdsBlobTooLargeError(buffer.byteLength, MAX_PDS_BLOB_SIZE_BYTES)
  }

  const cid = await cidForRawBytes(buffer)
  const cidStr = cid.toString()

  // Serialize against the per-DID repo lock held by commit and purge paths
  // through their blob file deletions, so an upload cannot interleave with a
  // concurrent commit that removes the same CID's row.
  return withPdsRepoLock(
    database,
    did,
    async () => {
      await assertPdsRepoAvailable(database, { did, requireEnabled: true })

      const store = resolvePdsBlobObjectStore(options.store)
      const existing = await database.getPdsBlob({
        did,
        cid: cidStr,
        includeUnreferenced: true
      })
      if (existing) return toUploadResult(existing, cid)

      const storageKey = getPdsBlobStorageKey(did, cidStr)
      await store.put(storageKey, buffer, normalizedMime)

      let row: PdsBlob
      try {
        row = await database.createPdsBlob({
          did,
          cid: cidStr,
          mimeType: normalizedMime,
          size: buffer.byteLength,
          storageKey
        })
      } catch (error) {
        // Check for the row before deleting anything: the INSERT may have
        // committed before the failure, so never delete a file a row might
        // point to.
        let persisted: PdsBlob | null
        try {
          persisted = await database.getPdsBlob({
            did,
            cid: cidStr,
            includeUnreferenced: true
          })
        } catch {
          throw error
        }

        if (!persisted) {
          await store.delete(storageKey).catch(() => undefined)
          throw error
        }
        row = persisted
      }

      if (row.storageKey !== storageKey) {
        // Another upload owns the row; ours is an orphan file.
        await store.delete(storageKey).catch(() => undefined)
      }

      try {
        await assertPdsRepoAvailable(database, { did, requireEnabled: true })
      } catch (availabilityError) {
        if (row.storageKey === storageKey) {
          const rowRemoved = await database
            .deletePdsBlob({ did, cid: cidStr, storageKey })
            .then(
              () => true,
              () => false
            )
          if (rowRemoved) {
            await store.delete(storageKey).catch(() => undefined)
          }
        }
        throw availabilityError
      }

      return toUploadResult(row, cid)
    },
    { ttlMs: PDS_BLOB_REPO_LOCK_TTL_MS }
  )
}

export type ReadPdsBlobResult = {
  cid: string
  mimeType: string
  size: number
  stream: Readable
}

/**
 * Looks up a stored PDS blob by `(did, cid)` and returns a readable stream of
 * its exact bytes, or `null` if not found.
 *
 * The repo is checked first, the same way the other sync reads check it: a
 * deactivated or taken-down repo's blobs are refused with `RepoDeactivated` /
 * `RepoTakendown` rather than served. `domain` scopes the lookup to one PDS
 * domain, as the reads do. `allowUnavailable` is for the move's post-switch
 * copy, which reads a repo this server has just deactivated.
 */
export const readPdsBlob = async (
  database: Database,
  { did, cid, domain }: { did: string; cid: string; domain?: string },
  options: { store?: PdsBlobObjectStore; allowUnavailable?: boolean } = {}
): Promise<ReadPdsBlobResult | null> => {
  await assertPdsRepoAvailable(database, {
    did,
    domain,
    allowUnavailable: options.allowUnavailable ?? false
  })

  const row = await database.getPdsBlob({ did, cid })
  if (!row) return null

  const store = resolvePdsBlobObjectStore(options.store)
  const stream = await store.openRead(row.storageKey)
  if (!stream) return null

  return {
    cid: row.cid,
    mimeType: row.mimeType,
    size: row.size,
    stream
  }
}

import { randomBytes, randomUUID } from 'crypto'

import type { Database } from '@/lib/database/types'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import {
  type AccountArchive,
  type AccountArchiveOptions,
  getArchiveStorageRoot
} from '@/lib/types/domain/accountArchive'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { ARCHIVE_REQUEST_INTERVAL_MS } from './constants'
import { prepareArchiveDrafts } from './drafts'
import {
  type ArchiveObjectStore,
  getArchiveObjectStore,
  getArchiveStorageKey
} from './objectStore'
import { getDraftsKey } from './progress'

export type RequestArchiveResult =
  | { ok: true; archive: AccountArchive }
  | { ok: false; reason: 'not-configured' }
  | { ok: false; reason: 'running'; archive: AccountArchive }
  | { ok: false; reason: 'rate-limited'; nextAllowedAt: number }
  | { ok: false; reason: 'drafts-invalid' | 'drafts-too-large' }

const isUniqueViolation = (error: unknown) => {
  const record = error as { code?: string; message?: string } | null
  return (
    record?.code === '23505' ||
    (typeof record?.code === 'string' &&
      record.code.startsWith('SQLITE_CONSTRAINT')) ||
    /unique constraint/i.test(record?.message ?? '')
  )
}

/**
 * Starts an export for the account. One may run at a time, and a new one is
 * allowed 7 days after the last one that was not a failure. The first
 * `queued` row is the lock: the partial unique index on the account turns a
 * double click into one export.
 */
export const requestAccountArchive = async ({
  database,
  accountId,
  options,
  drafts,
  store = getArchiveObjectStore(),
  now = Date.now
}: {
  database: Database
  accountId: string
  options: { stripExactLocations?: boolean }
  /** The drafts payload from the request, when the owner chose to include it. */
  drafts?: unknown
  store?: ArchiveObjectStore | null
  now?: () => number
}): Promise<RequestArchiveResult> => {
  if (!store) return { ok: false, reason: 'not-configured' }

  const hasDrafts = drafts !== undefined && drafts !== null
  let draftsJson: string | null = null
  if (hasDrafts) {
    const prepared = prepareArchiveDrafts(drafts, { now })
    if (!prepared.ok) {
      return {
        ok: false,
        reason:
          prepared.reason === 'too-large'
            ? 'drafts-too-large'
            : 'drafts-invalid'
      }
    }
    draftsJson = prepared.json
  }

  const active = await database.getActiveAccountArchive({ accountId })
  if (active) return { ok: false, reason: 'running', archive: active }

  const latest = await database.getLatestRequestedAccountArchive({ accountId })
  if (latest) {
    const nextAllowedAt = latest.createdAt + ARCHIVE_REQUEST_INTERVAL_MS
    if (nextAllowedAt > now()) {
      return { ok: false, reason: 'rate-limited', nextAllowedAt }
    }
  }

  const id = randomUUID()
  const storageToken = randomBytes(32).toString('base64url')
  const root = getArchiveStorageRoot({ id, storageToken })
  const archiveOptions: AccountArchiveOptions = {
    stripExactLocations: options.stripExactLocations === true,
    drafts: draftsJson !== null
  }

  let archive: AccountArchive
  try {
    archive = await database.createAccountArchive({
      id,
      accountId,
      storageToken,
      options: archiveOptions
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await database.getActiveAccountArchive({ accountId })
      if (raced) return { ok: false, reason: 'running', archive: raced }
    }
    throw error
  }

  // The drafts are staged after the row exists, so a request that dies between
  // the two leaves a row the reaper handles instead of an object nobody owns.
  if (draftsJson !== null) {
    try {
      await store.put(getDraftsKey(root), draftsJson)
    } catch (error) {
      await database.updateAccountArchive({
        id,
        status: 'failed',
        error: 'The drafts could not be stored'
      })
      throw error
    }
  }

  const queue = getQueue()
  const message = {
    id: `export-account-archive-${id}-0`,
    name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
    data: { archiveId: id, slice: 0 }
  }
  const failQueueing = async (error: unknown) => {
    logger.error({
      message: 'Failed to queue the account archive export',
      archiveId: id,
      err: toLoggableError(error)
    })
    await database
      .updateAccountArchive({
        id,
        status: 'failed',
        error: 'The export could not be queued'
      })
      .catch(() => undefined)
    await store.deletePrefix(getArchiveStorageKey(root)).catch(() => undefined)
  }
  if (queue.runsInline) {
    // The in-process queue runs the whole export inside `publish`: the request
    // must not wait for it.
    void queue.publish(message).catch(failQueueing)
  } else {
    try {
      await queue.publish(message)
    } catch (error) {
      await failQueueing(error)
      throw error
    }
  }
  return { ok: true, archive }
}

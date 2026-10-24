import { randomBytes } from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import { runAssemblySlice } from '@/lib/services/accountArchive/assemble'
import { getArchiveSliceBudgetMs } from '@/lib/services/accountArchive/budget'
import {
  ARCHIVE_MAX_SLICE_FAILURES,
  ARCHIVE_RETENTION_MS
} from '@/lib/services/accountArchive/constants'
import {
  deleteArchiveFiles,
  discardUnfinishedArchive,
  expireArchiveIfDue
} from '@/lib/services/accountArchive/expiry'
import {
  type ArchiveObjectStore,
  getArchiveObjectStore
} from '@/lib/services/accountArchive/objectStore'
import {
  parseProgress,
  serializeProgress
} from '@/lib/services/accountArchive/progress'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  StaleSliceError,
  runCollectionSlice
} from '@/lib/services/accountArchive/runner'
import {
  LeaseHeldError,
  isLeaseHeld
} from '@/lib/services/accountArchive/saver'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { resolveEmailIdentity } from '@/lib/services/email/sender'
import { buildAccountArchiveReadyEmail } from '@/lib/services/email/templates/accountArchiveReady'
import { getQueue } from '@/lib/services/queue'
import {
  type AccountArchive,
  getArchiveStorageRoot
} from '@/lib/types/domain/accountArchive'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from './names'

const JobData = z.object({
  archiveId: z.string().min(1),
  slice: z.number().int().nonnegative().default(0),
  action: z.enum(['expire']).optional()
})

const FAILURE_MESSAGE = 'The export could not be completed'
// A delayed expiry may arrive a little early; the sweep covers the rest.
const EXPIRE_EARLY_TOLERANCE_MS = 60 * 1000

const publishNextSlice = async (archiveId: string, slice: number) => {
  // `slice` is a run number, and a run finishes once, so this id is new.
  await getQueue().publish({
    id: getHashFromString(`${archiveId}:run:${slice}`),
    name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
    data: { archiveId, slice }
  })
}

const publishExpiry = async (archive: AccountArchive) => {
  const queue = getQueue()
  // The in-process queue has no scheduler; the periodic sweep expires the file.
  if (queue.runsInline) return
  try {
    await queue.publish({
      id: getHashFromString(`${archive.id}:expire`),
      name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { archiveId: archive.id, action: 'expire' },
      delaySeconds: Math.ceil(ARCHIVE_RETENTION_MS / 1000)
    })
  } catch (error) {
    logger.error({
      message:
        'Failed to queue the account archive expiry; the sweep covers it',
      archiveId: archive.id,
      err: toArchiveLoggableError(error)
    })
  }
}

const sendReadyEmail = async ({
  database,
  archive,
  domain
}: {
  database: Database
  archive: AccountArchive
  domain: string | null
}) => {
  if (!getConfig().email) return
  try {
    const account = await database.getAccountExportAccount({
      accountId: archive.accountId
    })
    if (!account?.email || archive.bytes === null || !archive.expiresAt) return
    const { brand, from } = await resolveEmailIdentity(
      database,
      domain ? getServedLinkDomain(domain) : null
    )
    const email = buildAccountArchiveReadyEmail({
      recipientEmail: account.email,
      archiveId: archive.id,
      bytes: archive.bytes,
      expiresAt: archive.expiresAt,
      brand
    })
    await sendMail({
      from,
      to: [account.email],
      subject: email.subject,
      content: { text: email.text, html: email.html }
    })
  } catch (error) {
    // The export is ready whether or not the notice went out.
    logger.error({
      message: 'Failed to send the account archive ready email',
      archiveId: archive.id,
      err: toArchiveLoggableError(error)
    })
  }
}

const markFailed = async ({
  database,
  store,
  archive,
  reason,
  onlyIfProgress
}: {
  database: Database
  store: ArchiveObjectStore | null
  archive: AccountArchive
  reason: string
  /** Fail it only while the cursor still reads as this (nobody saved since). */
  onlyIfProgress?: string | null
}) => {
  const failed = await database.updateAccountArchive({
    id: archive.id,
    onlyIfStatus: ['queued', 'running'],
    ...(onlyIfProgress !== undefined ? { onlyIfProgress } : null),
    status: 'failed',
    error: reason,
    progress: null
  })
  // Nothing matched: another worker moved the export on, and what it is writing
  // is not ours to throw away.
  if (failed && store) await discardUnfinishedArchive(store, archive)
}

/**
 * Records a slice failure in the cursor. After `ARCHIVE_MAX_SLICE_FAILURES` in a
 * row the export is marked failed and cleaned up; before that the error is
 * rethrown so the queue retries the same slice. The failing worker's lease is
 * cleared so the retry is not turned away by it.
 */
const handleSliceFailure = async ({
  database,
  store,
  archiveId,
  token,
  error
}: {
  database: Database
  store: ArchiveObjectStore | null
  archiveId: string
  token: string
  error: unknown
}) => {
  logger.error({
    message: 'Account archive export slice failed',
    archiveId,
    err: toArchiveLoggableError(error)
  })
  const current = await database.getAccountArchive({ id: archiveId })
  const progress = parseProgress(current?.progress ?? null)
  if (!current || !progress || current.status !== 'running') throw error

  // Another worker holds the export now (this one's lease lapsed). Its failure
  // is not the run's: writing it would replace the owner's saved cursor, and
  // the owner would stop at its next save. The owner carries the run.
  if (isLeaseHeld(progress, token, Date.now())) {
    logger.warn({
      message: 'Account archive export slice failed after losing its lease',
      archiveId
    })
    return
  }

  progress.failures += 1
  if (progress.lease?.token === token) progress.lease = null
  if (progress.failures >= ARCHIVE_MAX_SLICE_FAILURES) {
    await markFailed({
      database,
      store,
      archive: current,
      reason: FAILURE_MESSAGE,
      onlyIfProgress: current.progress
    })
    return
  }
  await database.updateAccountArchive({
    id: archiveId,
    onlyIfStatus: ['running'],
    onlyIfProgress: current.progress,
    progress: serializeProgress(progress)
  })
  throw error
}

export const exportAccountArchiveJob = createJobHandle(
  EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
  async (database, message) => {
    const data = JobData.parse(message.data)
    const archive = await database.getAccountArchive({ id: data.archiveId })
    if (!archive) return

    const store = getArchiveObjectStore()

    if (data.action === 'expire') {
      await expireArchiveIfDue({
        database,
        archive,
        store,
        now: () => Date.now() + EXPIRE_EARLY_TOLERANCE_MS
      })
      return
    }

    if (archive.status !== 'queued' && archive.status !== 'running') return
    if (!store) {
      await markFailed({
        database,
        store,
        archive,
        reason: 'Storage is not configured'
      })
      return
    }

    // A duplicate or late delivery of a run that already finished, or one from
    // the future. A retry of a run that did not finish is the current one.
    const known = parseProgress(archive.progress)
    if (known && data.slice !== known.completed + 1) {
      // The redelivery of the run that just finished: its release save landed
      // but the message for the next run may not have gone out (the publish
      // failed, or the worker died between the two). Publish it again under
      // its own id; a queue that dedupes drops the copy if the first one did
      // arrive, and a copy that slips through (Cloud Tasks does not dedupe)
      // meets the lease or the run check.
      if (
        data.slice === known.completed &&
        archive.status === 'running' &&
        !isLeaseHeld(known, '', Date.now())
      ) {
        await publishNextSlice(archive.id, data.slice + 1)
      }
      return
    }

    let running: AccountArchive | null = archive
    if (archive.status === 'queued') {
      running = await database.updateAccountArchive({
        id: archive.id,
        onlyIfStatus: ['queued'],
        status: 'running'
      })
      // Another worker started it first; read the row it now has.
      running ??= await database.getAccountArchive({ id: archive.id })
    }
    if (!running || running.status !== 'running') return

    const token = randomBytes(8).toString('hex')
    const budgetMs = getArchiveSliceBudgetMs()
    const deadline = Date.now() + budgetMs
    const root = getArchiveStorageRoot(archive)

    try {
      const { outcome, saver } = await runCollectionSlice({
        database,
        archive: running,
        store,
        budgetMs,
        token
      })
      const progress = saver.progress

      // Both stages end the same way when time runs out: hand the export on.
      const continueLater = async () => {
        // This run made progress: it is finished and the failure count starts
        // again. Both ride on the save that releases the lease.
        progress.completed = data.slice
        progress.failures = 0
        await saver.release()
        // Progress was made, so earlier stalls no longer count toward giving up.
        if (running.reapCount > 0) {
          await database.updateAccountArchive({
            id: archive.id,
            onlyIfStatus: ['running'],
            reapCount: 0
          })
        }
        await publishNextSlice(archive.id, data.slice + 1)
      }

      if (outcome === 'budget') {
        await continueLater()
        return
      }

      const assembled = await runAssemblySlice({
        database,
        archive: running,
        store,
        saver,
        deadline
      })
      if (!assembled.done) {
        await continueLater()
        return
      }

      const now = Date.now()
      const ready = await database.updateAccountArchive({
        id: archive.id,
        onlyIfStatus: ['running'],
        // Still the worker that holds the export: nobody saved since.
        onlyIfProgress: saver.savedText,
        status: 'ready',
        storagePath: assembled.key,
        bytes: assembled.bytes,
        readyAt: now,
        expiresAt: now + ARCHIVE_RETENTION_MS,
        progress: null,
        error: null
      })
      if (!ready) {
        // Lost the race. The winner owns this file, so nothing is deleted
        // here, unless the export is gone altogether.
        if (!(await database.getAccountArchive({ id: archive.id }))) {
          await deleteArchiveFiles(store, archive.id).catch(() => undefined)
        }
        return
      }
      await store.deletePrefix(`archives/${root}/stage`).catch(() => undefined)

      const defaultActor =
        progress.actors.find((actor) => actor.isDefault) ?? progress.actors[0]
      await sendReadyEmail({
        database,
        archive: ready,
        domain: defaultActor?.domain ?? null
      })
      await publishExpiry(ready)
    } catch (error) {
      // Another delivery holds the export: not a failure of this one, and not
      // to be acknowledged, or the queue would never bring it back.
      if (error instanceof LeaseHeldError) throw error
      if (error instanceof StaleSliceError) {
        // Another worker owns the export now. If the account is gone, what this
        // slice staged is garbage nobody will collect.
        if (!(await database.getAccountArchive({ id: archive.id }))) {
          await deleteArchiveFiles(store, archive.id).catch(() => undefined)
        }
        return
      }
      await handleSliceFailure({
        database,
        store,
        archiveId: archive.id,
        token,
        error
      })
    }
  }
)

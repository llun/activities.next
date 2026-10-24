import { z } from 'zod'

import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import { assembleArchive } from '@/lib/services/accountArchive/assemble'
import {
  ARCHIVE_MAX_SLICE_FAILURES,
  ARCHIVE_RETENTION_MS
} from '@/lib/services/accountArchive/constants'
import {
  deleteArchiveFiles,
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
import {
  StaleSliceError,
  runCollectionSlice
} from '@/lib/services/accountArchive/runner'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { resolveEmailIdentity } from '@/lib/services/email/sender'
import { buildAccountArchiveReadyEmail } from '@/lib/services/email/templates/accountArchiveReady'
import { getQueue } from '@/lib/services/queue'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

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
  await getQueue().publish({
    id: getHashFromString(`${archiveId}:slice:${slice}`),
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
      err: toLoggableError(error)
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
      err: toLoggableError(error)
    })
  }
}

const markFailed = async ({
  database,
  store,
  archiveId,
  reason
}: {
  database: Database
  store: ArchiveObjectStore | null
  archiveId: string
  reason: string
}) => {
  await database.updateAccountArchive({
    id: archiveId,
    onlyIfStatus: ['queued', 'running'],
    status: 'failed',
    error: reason,
    progress: null
  })
  if (store) {
    await deleteArchiveFiles(store, archiveId).catch(() => undefined)
  }
}

/**
 * Records a slice failure in the cursor. After `ARCHIVE_MAX_SLICE_FAILURES` in a
 * row the export is marked failed and cleaned up; before that the error is
 * rethrown so the queue retries the same slice.
 */
const handleSliceFailure = async ({
  database,
  store,
  archiveId,
  error
}: {
  database: Database
  store: ArchiveObjectStore | null
  archiveId: string
  error: unknown
}) => {
  logger.error({
    message: 'Account archive export slice failed',
    archiveId,
    err: toLoggableError(error)
  })
  const current = await database.getAccountArchive({ id: archiveId })
  const progress = parseProgress(current?.progress ?? null)
  if (!current || !progress || current.status !== 'running') throw error

  progress.failures += 1
  if (progress.failures >= ARCHIVE_MAX_SLICE_FAILURES) {
    await markFailed({ database, store, archiveId, reason: FAILURE_MESSAGE })
    return
  }
  await database.updateAccountArchive({
    id: archiveId,
    onlyIfStatus: ['running'],
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
        archiveId: archive.id,
        reason: 'Storage is not configured'
      })
      return
    }

    // A duplicate or late delivery of a slice that already ran.
    const known = parseProgress(archive.progress)
    if (known && data.slice < known.slice) return

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

    try {
      const { outcome, progress } = await runCollectionSlice({
        database,
        archive: running,
        store,
        slice: data.slice
      })

      if (progress.failures > 0) {
        progress.failures = 0
        await database.updateAccountArchive({
          id: archive.id,
          onlyIfStatus: ['running'],
          progress: serializeProgress(progress)
        })
      }

      if (outcome === 'budget') {
        await publishNextSlice(archive.id, progress.slice + 1)
        return
      }

      const assembled = await assembleArchive({
        database,
        archive: running,
        store,
        progress
      })
      const now = Date.now()
      const ready = await database.updateAccountArchive({
        id: archive.id,
        onlyIfStatus: ['running'],
        status: 'ready',
        storagePath: assembled.key,
        bytes: assembled.bytes,
        readyAt: now,
        expiresAt: now + ARCHIVE_RETENTION_MS,
        progress: null,
        error: null
      })
      if (!ready) {
        // The export was failed or removed while it was being built.
        await deleteArchiveFiles(store, archive.id).catch(() => undefined)
        return
      }
      await store
        .deletePrefix(`${assembled.key.replace(/\/archive\.zip$/, '')}/stage`)
        .catch(() => undefined)

      const defaultActor =
        progress.actors.find((actor) => actor.isDefault) ?? progress.actors[0]
      await sendReadyEmail({
        database,
        archive: ready,
        domain: defaultActor?.domain ?? null
      })
      await publishExpiry(ready)
    } catch (error) {
      if (error instanceof StaleSliceError) return
      await handleSliceFailure({
        database,
        store,
        archiveId: archive.id,
        error
      })
    }
  }
)

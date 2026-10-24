import type { Database } from '@/lib/database/types'

import { type ArchiveProgress, serializeProgress } from './progress'

/** Another worker saved the cursor first; this one stops without writing. */
export class StaleSliceError extends Error {
  constructor(message = 'The export cursor moved on; another worker owns it') {
    super(message)
    this.name = 'StaleSliceError'
  }
}

/** A live lease belongs to another worker. */
export class LeaseHeldError extends StaleSliceError {
  constructor() {
    super('Another worker holds the export lease')
    this.name = 'LeaseHeldError'
  }
}

/** A worker's claim on an export is this long past its slice budget. */
export const ARCHIVE_LEASE_GRACE_MS = 60 * 1000

/**
 * Saves the cursor with a compare-and-set on the text last saved, so a worker
 * whose lease lapsed and was taken over finds out on its next save instead of
 * overwriting the new owner's progress. Every save also moves the row's
 * heartbeat.
 */
export class ProgressSaver {
  constructor(
    private readonly database: Database,
    private readonly archiveId: string,
    readonly progress: ArchiveProgress,
    /** The text currently stored (null before the first save). */
    private saved: string | null
  ) {}

  get savedText() {
    return this.saved
  }

  async save() {
    const text = serializeProgress(this.progress)
    const updated = await this.database.updateAccountArchive({
      id: this.archiveId,
      onlyIfStatus: ['running'],
      onlyIfProgress: this.saved,
      progress: text
    })
    if (!updated) throw new StaleSliceError()
    this.saved = text
  }

  /** Ends this worker's slice: the next delivery may take the export. */
  async release() {
    this.progress.lease = null
    await this.save()
  }
}

/**
 * Whether the lease on `progress` stops a worker that is not `token`. A lease
 * with the worker's own token (a retry of the same delivery) does not.
 */
export const isLeaseHeld = (
  progress: ArchiveProgress,
  token: string,
  now: number
) =>
  Boolean(
    progress.lease &&
    progress.lease.token !== token &&
    progress.lease.until > now
  )

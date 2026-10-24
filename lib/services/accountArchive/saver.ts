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

/** This worker's lease ran out (or is about to): another may own the export. */
export class LeaseExpiredError extends LeaseHeldError {
  constructor() {
    super()
    this.message = 'The export lease of this worker has run out'
    this.name = 'LeaseExpiredError'
  }
}

/**
 * A worker stops writing to keys another worker could also write this long
 * before its lease ends: one S3 call (`ARCHIVE_S3_REQUEST_TIMEOUT_MS`) may
 * still be in flight when the check passes.
 */
export const ARCHIVE_LEASE_SAFETY_MS = 30 * 1000

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

  /**
   * Throws when this worker's own lease has run out, or will within the safety
   * margin. Called before every write to a key that a later worker (or a
   * redelivery) writes too, so a worker that stalled past its lease and woke up
   * after a takeover cannot overwrite what the new owner wrote. The slice is
   * retried, from the last saved cursor.
   */
  assertLeased(now: number) {
    const lease = this.progress.lease
    if (lease && now >= lease.until - ARCHIVE_LEASE_SAFETY_MS) {
      throw new LeaseExpiredError()
    }
  }

  /** Ends this worker's slice: the next delivery may take the export. */
  async release() {
    this.progress.lease = null
    await this.save()
  }
}

/**
 * Whether the lease on `progress` stops a worker that is not `token`. A lease
 * with the worker's own token does not. Each delivery uses a fresh token, so
 * this matters only to a caller that holds one across calls; a retry of a
 * failed delivery gets in because `handleSliceFailure` clears the lease.
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

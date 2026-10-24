import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import { importRow, isValidListName } from '@/lib/services/imports/importRow'
import { applyOverwrite } from '@/lib/services/imports/overwrite'
import { getQueue } from '@/lib/services/queue'
import type { JobMessage } from '@/lib/services/queue/type'
import type { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

// `waitedFor` is the holder a wait job waited out (see runBulkImport).
const WaitedFor = z.object({ runToken: z.string(), claimedUntil: z.number() })
type WaitedFor = z.infer<typeof WaitedFor>

const JobData = z.object({
  importId: z.string(),
  waitedFor: WaitedFor.optional()
})

// Each run must finish well inside the queue's per-job timeout: QStash caps a
// job at 30s (MAX_JOB_TIMEOUT_SECONDS), so a run stops at 20s (checked after
// every unit of work, rows do remote work inline) and hands the rest to a
// continuation job. See generateFitnessRouteHeatmapJob for the same budget.
export const BULK_IMPORT_JOB_TIME_BUDGET_MS = 20_000
// The claim outlives the budget by this much so a run that overshoots by one
// slow row still holds it.
const CLAIM_GRACE_MS = 15_000
// A live run renews its lease this often (at most a third of the lease), so a
// lapsed lease means the run is dead, however long one unit of work takes.
export const BULK_IMPORT_HEARTBEAT_MS = 10_000
const WAIT_BUFFER_SECONDS = 2
const ROW_PAGE_SIZE = 100

export const getBulkImportContinueJobId = (
  importId: string,
  nextRowIndex: number
): string => `${importId}:continue:${nextRowIndex}`

export const getBulkImportOverwriteJobId = (
  importId: string,
  overwriteProgress: number
): string => `${importId}:overwrite:${overwriteProgress}`

export const getBulkImportWaitJobId = (
  importId: string,
  holder: WaitedFor | null
): string =>
  holder
    ? `${importId}:wait:${holder.runToken}:${holder.claimedUntil}`
    : `${importId}:wait:released`

type RunOptions = {
  // Time left before the job hands over to a continuation.
  budgetMs?: number
  pageSize?: number
  // Set by a wait job: the holder (token and lease) it waited for.
  waitedFor?: WaitedFor
}

const continuation = (id: string, importId: string): JobMessage => ({
  id,
  name: BULK_IMPORT_JOB_NAME,
  data: { importId }
})

// Thrown when another run took the import over; the run stops at once and
// writes and publishes nothing more.
class LeaseLostError extends Error {}

// Renews this run's lease and throws LeaseLostError if it is no longer ours.
type Renew = () => Promise<void>

// Mastodon's find_or_create_by!(title:) for every list name in the file. A
// title that cannot be created only fails its own rows.
const prepareLists = async (
  database: Database,
  actor: Actor,
  importId: string,
  pageSize: number
) => {
  const titles = new Set<string>()
  let fromRowIndex = 0
  for (;;) {
    const page = await database.getBulkImportRows({
      importId,
      fromRowIndex,
      limit: pageSize
    })
    for (const row of page) {
      if (isValidListName(row.data.list_name)) titles.add(row.data.list_name)
    }
    if (page.length < pageSize) break
    fromRowIndex = page[page.length - 1].rowIndex + 1
  }
  const existing = new Set(
    (await database.getLists({ actorId: actor.id })).map((list) => list.title)
  )
  for (const title of titles) {
    if (existing.has(title)) continue
    try {
      await database.createList({ actorId: actor.id, title })
    } catch (error) {
      logger.error({
        message: 'Bulk import could not create a list',
        importId,
        err: toLoggableError(error)
      })
    }
  }
}

// One run, with the import claimed. Returns the continuation to publish once
// the claim is released, if any.
const processImport = async (
  database: Database,
  importId: string,
  deadline: number,
  pageSize: number,
  renew: Renew
): Promise<JobMessage | undefined> => {
  // Read after the claim: an earlier run may just have moved the import on.
  const bulkImport = await database.getBulkImportById({ id: importId })
  if (!bulkImport || bulkImport.state === 'finished') return

  const actor = await database.getActorFromId({ id: bulkImport.actorId })
  if (!actor) {
    await database.updateBulkImport({
      id: importId,
      state: 'finished',
      lastError: 'Actor not found',
      finishedAt: Date.now()
    })
    return
  }

  try {
    await database.updateBulkImport({ id: importId, state: 'in_progress' })

    if (bulkImport.overwrite && !bulkImport.overwriteDone) {
      const { done, units } = await applyOverwrite({
        database,
        actor,
        bulkImport,
        deadline,
        renew
      })
      if (!done) {
        await renew()
        const overwriteProgress = bulkImport.overwriteProgress + units
        await database.updateBulkImport({ id: importId, overwriteProgress })
        return continuation(
          getBulkImportOverwriteJobId(importId, overwriteProgress),
          importId
        )
      }
      // Recorded before the row pass can add anything the overwrite clears.
      await renew()
      await database.updateBulkImport({ id: importId, overwriteDone: true })
    }

    if (bulkImport.type === 'lists' && !bulkImport.listsPrepared) {
      await prepareLists(database, actor, importId, pageSize)
      await renew()
      await database.updateBulkImport({ id: importId, listsPrepared: true })
    }

    let nextRowIndex = bulkImport.nextRowIndex
    for (;;) {
      const rows = await database.getBulkImportRows({
        importId,
        fromRowIndex: nextRowIndex,
        limit: pageSize,
        state: 'pending'
      })
      for (const row of rows) {
        // Mastodon retries a failing row a few times before counting it as
        // processed and not imported; one attempt is enough here.
        let result: { imported: boolean; error?: string }
        try {
          result = await importRow({
            database,
            actor,
            type: bulkImport.type,
            data: row.data
          })
        } catch (error) {
          logger.error({
            message: 'Bulk import row failed',
            importId,
            rowIndex: row.rowIndex,
            err: toLoggableError(error)
          })
          // The row error is shown to the user; keep internals out of it.
          result = { imported: false, error: 'Could not import this row' }
        }
        // Before marking: a run that lost the import leaves the row pending
        // for the new holder (every row is idempotent).
        await renew()
        await database.markBulkImportRowProcessed({
          importId,
          rowId: row.id,
          imported: result.imported,
          error: result.error
        })

        if (Date.now() >= deadline) {
          nextRowIndex = row.rowIndex + 1
          await renew()
          await database.updateBulkImport({ id: importId, nextRowIndex })
          return continuation(
            getBulkImportContinueJobId(importId, nextRowIndex),
            importId
          )
        }
      }

      if (rows.length === 0) break
      nextRowIndex = rows[rows.length - 1].rowIndex + 1
      await renew()
      await database.updateBulkImport({ id: importId, nextRowIndex })

      if (rows.length < pageSize) break
    }

    // markBulkImportRowProcessed finishes the import when the counts meet;
    // this covers an empty file and one the pre-pass consumed entirely.
    await renew()
    const current = await database.getBulkImportById({ id: importId })
    if (current && current.state !== 'finished') {
      await database.updateBulkImport({
        id: importId,
        state: 'finished',
        finishedAt: Date.now()
      })
    }
  } catch (error) {
    // Not a failure of this run: the new holder owns the import's state.
    if (error instanceof LeaseLostError) throw error
    // Left unfinished so the queue's retry resumes from the checkpoint.
    logger.error({
      message: 'Bulk import failed',
      importId,
      err: toLoggableError(error)
    })
    // Renewing first skips the write (LeaseLostError) when the run lost the
    // import: lastError belongs to the new holder's state.
    await renew()
    await database.updateBulkImport({
      id: importId,
      lastError: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export const runBulkImport = async (
  database: Database,
  importId: string,
  {
    budgetMs = BULK_IMPORT_JOB_TIME_BUDGET_MS,
    pageSize = ROW_PAGE_SIZE,
    waitedFor
  }: RunOptions = {}
): Promise<void> => {
  // An inline queue (NoQueue) has no job timeout, and a continuation would
  // only nest another call, so it runs to completion in one go.
  const budget = getQueue().runsInline ? Number.POSITIVE_INFINITY : budgetMs
  const deadline = Date.now() + budget
  const leaseMs =
    Math.min(budget, BULK_IMPORT_JOB_TIME_BUDGET_MS) + CLAIM_GRACE_MS

  const bulkImport = await database.getBulkImportById({ id: importId })
  if (!bulkImport || bulkImport.state === 'finished') return

  // Another run (a redelivery, a retry racing a slow first attempt) may still
  // be working on this import; two would process the same rows.
  const runToken = randomUUID()
  const claim = await database.claimBulkImportRun({
    id: importId,
    runToken,
    leaseMs
  })
  if (!claim.claimed) {
    const holder =
      claim.runToken && claim.claimedUntil
        ? { runToken: claim.runToken, claimedUntil: claim.claimedUntil }
        : null
    // A wait job that finds another holder has been overtaken: that holder's
    // own continuation (or the queue's retry) covers the import, and
    // republishing would chain waits forever. The same holder, though, renews
    // its lease as it works, so its own renewals must not look like a new
    // claim: the wait goes on until that holder finishes or dies.
    if (waitedFor && holder?.runToken !== waitedFor.runToken) return
    // Try again once the claim lapses. A NoQueue drops the delayed message,
    // but it runs one job at a time in-process, so the holder is still going.
    const waitSeconds = holder
      ? Math.max(0, Math.ceil((holder.claimedUntil - Date.now()) / 1000))
      : 0
    await getQueue().publish({
      ...continuation(getBulkImportWaitJobId(importId, holder), importId),
      data: { importId, ...(holder ? { waitedFor: holder } : {}) },
      delaySeconds: waitSeconds + WAIT_BUFFER_SECONDS
    })
    return
  }

  // `lost`: a renewal changed no row, so another run holds the import and
  // this one stops quietly. `renewError`: a renewal threw, so the lease state
  // is unknown; the run stops by rethrowing it and the queue retries.
  let lost = false
  let renewError: unknown
  const renewLease = async () => {
    try {
      if (
        !(await database.renewBulkImportRun({
          id: importId,
          runToken,
          leaseMs
        }))
      )
        lost = true
    } catch (error) {
      logger.warn({
        message: 'Bulk import lease renewal failed',
        importId,
        err: toLoggableError(error)
      })
      renewError ??= error
    }
  }
  const renew: Renew = async () => {
    if (!lost && renewError === undefined) await renewLease()
    if (renewError !== undefined) throw renewError
    if (lost) throw new LeaseLostError()
  }
  // Keeps the lease alive through a unit of work longer than the lease. The
  // in-flight renewal is tracked so the run can wait for it before releasing:
  // nothing may still be pending once runBulkImport settles.
  let beat: Promise<void> | undefined
  const heartbeat = setInterval(
    () => {
      if (beat || lost || renewError !== undefined) return
      beat = renewLease().finally(() => {
        beat = undefined
      })
    },
    Math.min(BULK_IMPORT_HEARTBEAT_MS, leaseMs / 3)
  )
  heartbeat.unref?.()

  let next: JobMessage | undefined
  try {
    next = await processImport(database, importId, deadline, pageSize, renew)
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn({
        message: 'Bulk import run stopped: another run took the import over',
        importId
      })
      return
    }
    throw error
  } finally {
    clearInterval(heartbeat)
    await beat
    await database.releaseBulkImportRun({ id: importId, runToken })
  }
  // A renewal that threw during the last stretch: the run cannot vouch for
  // its work, so fail it (nothing is published) and let the queue retry.
  if (renewError !== undefined) throw renewError
  // After the release, so the continuation is not turned away by this claim.
  if (next) await getQueue().publish(next)
}

export const bulkImportJob = createJobHandle(
  BULK_IMPORT_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'bulkImport', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed bulk import job data'))
        return
      }
      await runBulkImport(database, parsed.data.importId, {
        waitedFor: parsed.data.waitedFor
      })
    })
  }
)

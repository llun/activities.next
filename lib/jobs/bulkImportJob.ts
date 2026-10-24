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

const JobData = z.object({ importId: z.string() })

// Each run must finish well inside the queue's per-job timeout: QStash caps a
// job at 30s (MAX_JOB_TIMEOUT_SECONDS), so a run stops at 20s (checked after
// every unit of work, rows do remote work inline) and hands the rest to a
// continuation job. See generateFitnessRouteHeatmapJob for the same budget.
export const BULK_IMPORT_JOB_TIME_BUDGET_MS = 20_000
// The claim outlives the budget by this much so a run that overshoots by one
// slow row still holds it.
const CLAIM_GRACE_MS = 15_000
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
  claimedUntil: number | null
): string => `${importId}:wait:${claimedUntil ?? 'released'}`

type RunOptions = {
  // Time left before the job hands over to a continuation.
  budgetMs?: number
  pageSize?: number
}

const continuation = (id: string, importId: string): JobMessage => ({
  id,
  name: BULK_IMPORT_JOB_NAME,
  data: { importId }
})

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
  pageSize: number
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
        deadline
      })
      if (!done) {
        const overwriteProgress = bulkImport.overwriteProgress + units
        await database.updateBulkImport({ id: importId, overwriteProgress })
        return continuation(
          getBulkImportOverwriteJobId(importId, overwriteProgress),
          importId
        )
      }
      // Recorded before the row pass can add anything the overwrite clears.
      await database.updateBulkImport({ id: importId, overwriteDone: true })
    }

    if (bulkImport.type === 'lists' && !bulkImport.listsPrepared) {
      await prepareLists(database, actor, importId, pageSize)
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
        await database.markBulkImportRowProcessed({
          importId,
          rowId: row.id,
          imported: result.imported,
          error: result.error
        })

        if (Date.now() >= deadline) {
          nextRowIndex = row.rowIndex + 1
          await database.updateBulkImport({ id: importId, nextRowIndex })
          return continuation(
            getBulkImportContinueJobId(importId, nextRowIndex),
            importId
          )
        }
      }

      if (rows.length === 0) break
      nextRowIndex = rows[rows.length - 1].rowIndex + 1
      await database.updateBulkImport({ id: importId, nextRowIndex })

      if (rows.length < pageSize) break
    }

    // markBulkImportRowProcessed finishes the import when the counts meet;
    // this covers an empty file and one the pre-pass consumed entirely.
    const current = await database.getBulkImportById({ id: importId })
    if (current && current.state !== 'finished') {
      await database.updateBulkImport({
        id: importId,
        state: 'finished',
        finishedAt: Date.now()
      })
    }
  } catch (error) {
    // Left unfinished so the queue's retry resumes from the checkpoint.
    logger.error({
      message: 'Bulk import failed',
      importId,
      err: toLoggableError(error)
    })
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
    pageSize = ROW_PAGE_SIZE
  }: RunOptions = {}
): Promise<void> => {
  const deadline = Date.now() + budgetMs

  const bulkImport = await database.getBulkImportById({ id: importId })
  if (!bulkImport || bulkImport.state === 'finished') return

  // Another run (a redelivery, a retry racing a slow first attempt) may still
  // be working on this import; two would process the same rows.
  const runToken = randomUUID()
  const claim = await database.claimBulkImportRun({
    id: importId,
    runToken,
    leaseMs: budgetMs + CLAIM_GRACE_MS
  })
  if (!claim.claimed) {
    // Try again once the claim lapses. A NoQueue drops the delayed message,
    // but it runs one job at a time in-process, so the holder is still going.
    const waitSeconds = claim.claimedUntil
      ? Math.max(0, Math.ceil((claim.claimedUntil - Date.now()) / 1000))
      : 0
    await getQueue().publish({
      ...continuation(
        getBulkImportWaitJobId(importId, claim.claimedUntil),
        importId
      ),
      delaySeconds: waitSeconds + WAIT_BUFFER_SECONDS
    })
    return
  }

  let next: JobMessage | undefined
  try {
    next = await processImport(database, importId, deadline, pageSize)
  } finally {
    await database.releaseBulkImportRun({ id: importId, runToken })
  }
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
      await runBulkImport(database, parsed.data.importId)
    })
  }
)

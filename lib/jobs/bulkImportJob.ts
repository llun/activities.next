import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import { importRow } from '@/lib/services/imports/importRow'
import { applyOverwrite } from '@/lib/services/imports/overwrite'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({ importId: z.string() })

// Same budget the Strava archive import works to: stop with room to spare, then
// continue in a fresh job.
const MAX_JOB_RUNTIME_MS = 5 * 60 * 1_000
const REQUEUE_BUFFER_MS = 10 * 1_000
const ROW_PAGE_SIZE = 100

export const getBulkImportContinueJobId = (
  importId: string,
  nextRowIndex: number
): string => `${importId}:continue:${nextRowIndex}`

type RunOptions = {
  // Time left before the job hands over to a continuation.
  budgetMs?: number
  pageSize?: number
}

export const runBulkImport = async (
  database: Database,
  importId: string,
  {
    budgetMs = MAX_JOB_RUNTIME_MS - REQUEUE_BUFFER_MS,
    pageSize = ROW_PAGE_SIZE
  }: RunOptions = {}
): Promise<void> => {
  const deadline = Date.now() + budgetMs

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

    // shortcut: the pre-pass has no time check of its own (its removals are
    // local and quick); a killed run just starts it again, which is safe.
    if (bulkImport.overwrite && !bulkImport.overwriteDone) {
      await applyOverwrite({ database, actor, bulkImport })
      await database.updateBulkImport({ id: importId, overwriteDone: true })
    }

    if (bulkImport.type === 'lists') {
      // Mastodon's find_or_create_by!(title:) for every list name in the file.
      const titles = new Set<string>()
      let fromRowIndex = 0
      for (;;) {
        const page = await database.getBulkImportRows({
          importId,
          fromRowIndex,
          limit: pageSize
        })
        for (const row of page) {
          if (row.data.list_name) titles.add(row.data.list_name)
        }
        if (page.length < pageSize) break
        fromRowIndex = page[page.length - 1].rowIndex + 1
      }
      const existing = new Set(
        (await database.getLists({ actorId: actor.id })).map(
          (list) => list.title
        )
      )
      for (const title of titles) {
        if (!existing.has(title)) {
          await database.createList({ actorId: actor.id, title })
        }
      }
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
          logger.warn({
            message: 'Bulk import row failed',
            importId,
            rowIndex: row.rowIndex,
            err: toLoggableError(error)
          })
          result = {
            imported: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
        await database.markBulkImportRowProcessed({
          importId,
          rowId: row.id,
          imported: result.imported,
          error: result.error
        })
      }

      if (rows.length === 0) break
      nextRowIndex = rows[rows.length - 1].rowIndex + 1
      await database.updateBulkImport({ id: importId, nextRowIndex })

      if (rows.length < pageSize) break
      if (Date.now() >= deadline) {
        await getQueue().publish({
          id: getBulkImportContinueJobId(importId, nextRowIndex),
          name: BULK_IMPORT_JOB_NAME,
          data: { importId }
        })
        return
      }
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

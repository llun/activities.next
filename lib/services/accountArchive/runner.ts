import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import {
  getServedHostConfig,
  refreshServedDomains
} from '@/lib/services/domains/servedDomainSnapshot'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'

import {
  ARCHIVE_MAX_WARNINGS,
  ARCHIVE_PAGE_SIZE,
  ARCHIVE_SLICE_BUDGET_MS
} from './constants'
import { planArchiveActors } from './layout'
import type { ArchiveObjectStore } from './objectStore'
import {
  type ArchiveProgress,
  PartStager,
  createInitialProgress,
  parseProgress,
  serializeProgress
} from './progress'
import type { SourceKind } from './sourceFiles'
import type { CollectorStep, StepContext } from './steps.types'
import {
  fitnessFilesStep,
  fitnessMetaStep,
  galleryStep,
  mediasStep,
  reactionsStep,
  scheduledStep
} from './stepsExtras'
import { graphStep } from './stepsGraph'
import {
  bookmarksStep,
  likesStep,
  outboxStep,
  profileStep
} from './stepsMastodon'

/** The steps of one actor, in order. A new step goes at the end of the list. */
export const COLLECTOR_STEPS: readonly CollectorStep[] = [
  profileStep,
  outboxStep,
  likesStep,
  bookmarksStep,
  mediasStep,
  fitnessFilesStep,
  fitnessMetaStep,
  galleryStep,
  scheduledStep,
  reactionsStep,
  graphStep
]

/** Another worker saved the cursor first; this one stops without writing. */
export class StaleSliceError extends Error {
  constructor() {
    super('The export cursor moved on; another worker owns this slice')
    this.name = 'StaleSliceError'
  }
}

export type SliceOutcome =
  /** The time budget ran out: requeue the next slice. */
  | 'budget'
  /** Every actor is collected: the archive can be assembled. */
  | 'collected'

export interface RunSliceParams {
  database: Database
  archive: AccountArchive
  store: ArchiveObjectStore
  /** The slice number carried by the job message. */
  slice: number
  budgetMs?: number
  pageSize?: number
  now?: () => number
}

/**
 * Runs collector pages for one export until the time budget is spent, saving the
 * cursor after every page. Always does at least one page, so a budget of zero
 * still moves the export forward.
 *
 * Resuming is safe at any point: a page's parts are written to deterministic
 * keys before the cursor that counts them is saved, so a page run twice writes
 * the same bytes to the same places.
 */
export const runCollectionSlice = async ({
  database,
  archive,
  store,
  slice,
  budgetMs = ARCHIVE_SLICE_BUDGET_MS,
  pageSize = ARCHIVE_PAGE_SIZE,
  now = Date.now
}: RunSliceParams): Promise<{
  outcome: SliceOutcome
  progress: ArchiveProgress
}> => {
  const deadline = now() + budgetMs
  let savedText = archive.progress
  let progress = parseProgress(archive.progress)

  const save = async () => {
    progress!.updatedAt = now()
    const text = serializeProgress(progress!)
    const updated = await database.updateAccountArchive({
      id: archive.id,
      onlyIfStatus: ['running'],
      onlyIfProgress: savedText,
      progress: text
    })
    if (!updated) throw new StaleSliceError()
    savedText = text
  }

  if (!progress) {
    const [account, actors] = await Promise.all([
      database.getAccountExportAccount({ accountId: archive.accountId }),
      database.getAccountExportActors({ accountId: archive.accountId })
    ])
    if (!account || actors.length === 0) {
      throw new Error('The account has no actor to export')
    }
    progress = createInitialProgress({
      actors: planArchiveActors(actors, account.defaultActorId),
      now: now()
    })
    progress.slice = slice
    await save()
  }
  if (slice > progress.slice) {
    progress.slice = slice
  }
  if (progress.phase === 'assemble') return { outcome: 'collected', progress }

  // Attachment and image URLs on an Admin > Domains row are ours too.
  await refreshServedDomains(database)
  const hostConfig = getServedHostConfig(getConfig())

  const warn = (message: string) => {
    if (progress!.warnings.length < ARCHIVE_MAX_WARNINGS) {
      progress!.warnings.push(message)
    }
  }
  const memoCache = new Map<string, unknown>()
  let cacheOwner = -1

  do {
    if (progress.actorIndex >= progress.actors.length) {
      progress.phase = 'assemble'
      progress.cursor = null
      await save()
      return { outcome: 'collected', progress }
    }

    const step = COLLECTOR_STEPS[progress.step]
    if (!step) {
      progress.actorIndex += 1
      progress.step = 0
      progress.cursor = null
      await save()
      continue
    }

    if (cacheOwner !== progress.actorIndex) {
      memoCache.clear()
      cacheOwner = progress.actorIndex
    }
    const pendingFiles: { entry: string; kind: SourceKind; path: string }[] = []
    const stage = new PartStager(store, archive.id, progress)
    const context: StepContext = {
      database,
      accountId: archive.accountId,
      actor: progress.actors[progress.actorIndex],
      options: archive.options,
      hostConfig,
      pageSize,
      progress,
      stage,
      stats: progress.stats[progress.actorIndex],
      warn,
      memo: async <Value>(key: string, load: () => Promise<Value>) => {
        if (!memoCache.has(key)) memoCache.set(key, await load())
        return memoCache.get(key) as Value
      },
      addFile: (entry, kind, path) => {
        pendingFiles.push({ entry, kind, path })
      }
    }

    const result = await step.run(context, progress.cursor)
    await stage.stageFiles(pendingFiles)

    if (result === 'done') {
      progress.step += 1
      progress.cursor = null
    } else {
      progress.cursor = result.cursor
    }
    await save()
  } while (now() < deadline)

  return { outcome: 'budget', progress }
}

import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import {
  getServedHostConfig,
  refreshServedDomains
} from '@/lib/services/domains/servedDomainSnapshot'
import {
  type AccountArchive,
  getArchiveStorageRoot
} from '@/lib/types/domain/accountArchive'

import { getArchiveSliceBudgetMs } from './budget'
import { ARCHIVE_MAX_WARNINGS, ARCHIVE_PAGE_SIZE } from './constants'
import { planArchiveActors } from './layout'
import type { ArchiveObjectStore } from './objectStore'
import {
  type ArchiveProgress,
  PartStager,
  createInitialProgress,
  parseProgress
} from './progress'
import {
  ARCHIVE_LEASE_GRACE_MS,
  LeaseHeldError,
  ProgressSaver,
  isLeaseHeld
} from './saver'
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

export { StaleSliceError } from './saver'

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
  /** Identifies this worker in the lease it takes. */
  token: string
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
  budgetMs = getArchiveSliceBudgetMs(),
  pageSize = ARCHIVE_PAGE_SIZE,
  now = Date.now,
  token
}: RunSliceParams): Promise<{
  outcome: SliceOutcome
  progress: ArchiveProgress
  saver: ProgressSaver
}> => {
  const deadline = now() + budgetMs
  let progress = parseProgress(archive.progress)
  const leaseUntil = () => now() + budgetMs + ARCHIVE_LEASE_GRACE_MS

  if (progress && isLeaseHeld(progress, token, now()))
    throw new LeaseHeldError()

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
  }
  const saver = new ProgressSaver(
    database,
    archive.id,
    progress,
    archive.progress
  )
  progress.slice = Math.max(progress.slice, slice)
  progress.lease = { token, until: leaseUntil() }
  await saver.save()
  const save = () => saver.save()
  if (progress.phase === 'assemble')
    return { outcome: 'collected', progress, saver }

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
      return { outcome: 'collected', progress, saver }
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
    const stage = new PartStager(
      store,
      getArchiveStorageRoot(archive),
      progress
    )
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

  return { outcome: 'budget', progress, saver }
}

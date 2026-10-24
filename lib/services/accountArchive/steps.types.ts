import type { Database } from '@/lib/database/types'
import type { AccountArchiveOptions } from '@/lib/types/domain/accountArchive'
import type { HostRuleConfig } from '@/lib/utils/host'

import type { ArchiveActorPlan } from './layout'
import type { ArchiveActorStats, ArchiveProgress, PartStager } from './progress'
import type { SourceKind } from './sourceFiles'

/** Everything a collector step needs; one is built per actor per slice. */
export interface StepContext {
  database: Database
  accountId: string
  actor: ArchiveActorPlan
  options: AccountArchiveOptions
  hostConfig: HostRuleConfig
  pageSize: number
  progress: ArchiveProgress
  stage: PartStager
  stats: ArchiveActorStats
  warn: (message: string) => void
  /** Loads a value once per actor per slice (small lookups reused by every page). */
  memo: <Value>(key: string, load: () => Promise<Value>) => Promise<Value>
  /** Queues a stored file to be copied into the zip as `entry`. */
  addFile: (entry: string, kind: SourceKind, storagePath: string) => void
}

/** `'done'` when the step has nothing left; otherwise the cursor for the next page. */
export type StepResult = 'done' | { cursor: unknown }

/**
 * One resumable unit of an actor's export. `run` does at most one page of work
 * and returns, so the runner can check its time budget and save the cursor
 * between pages.
 */
export interface CollectorStep {
  name: string
  run: (context: StepContext, cursor: unknown) => Promise<StepResult>
}

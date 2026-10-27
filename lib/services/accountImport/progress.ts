export type ArchiveStatusOrder = 'oldest-first' | 'newest-first'
export type CatalogStage =
  | 'statuses'
  | 'likes'
  | 'bookmarks'
  | 'ownMedia'
  | 'galleryGears'
  | 'fitnessGears'
  | 'albums'
  | 'fitnessFiles'
  | 'done'

export interface AccountImportProgress {
  version: 1
  sourceActorId: string | null
  sourceFollowersUrl: string | null
  /** Resolved from the archive's own profile.json and reused across phases. */
  sourceExtrasDir?: string | null
  statusOrder: ArchiveStatusOrder
  catalogStage: CatalogStage
  catalogIndex: number
  totalItems: number
  completedItems: number
  skippedItems: number
  /**
   * How many continuations this import has already published. The runner and
   * the reaper put it in every continuation queue id, so a later pass over the
   * same phase and cursor can never repeat an id the queue has already
   * consumed. Deterministic: it only ever counts up, never reads the clock.
   */
  continuationCount: number
  /** Selected by the owner at start; stored here because the row's initial
   * options column is immutable in the slice-1 database contract. */
  selectedOptions?: {
    likes: boolean
    bookmarks: boolean
    repliesToOthers: 'skip' | 'keep'
    profile: boolean
    settings: boolean
  }
}

export const createInitialImportProgress = (): AccountImportProgress => ({
  version: 1,
  sourceActorId: null,
  sourceFollowersUrl: null,
  statusOrder: 'newest-first',
  catalogStage: 'statuses',
  catalogIndex: 0,
  totalItems: 0,
  completedItems: 0,
  skippedItems: 0,
  continuationCount: 0
})

export const parseImportProgress = (
  value: string | null | undefined
): AccountImportProgress => {
  if (!value) return createInitialImportProgress()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object')
      return createInitialImportProgress()
    const record = parsed as Record<string, unknown>
    const stages: CatalogStage[] = [
      'statuses',
      'likes',
      'bookmarks',
      'ownMedia',
      'galleryGears',
      'fitnessGears',
      'albums',
      'fitnessFiles',
      'done'
    ]
    return {
      version: 1,
      sourceActorId:
        typeof record.sourceActorId === 'string' ? record.sourceActorId : null,
      sourceFollowersUrl:
        typeof record.sourceFollowersUrl === 'string'
          ? record.sourceFollowersUrl
          : null,
      ...(record.sourceExtrasDir === null ||
      (typeof record.sourceExtrasDir === 'string' &&
        record.sourceExtrasDir.startsWith('activities.next/actors/') &&
        !record.sourceExtrasDir.includes('\\') &&
        !record.sourceExtrasDir.split('/').some((part) => part === '..'))
        ? { sourceExtrasDir: record.sourceExtrasDir as string | null }
        : null),
      statusOrder:
        record.statusOrder === 'oldest-first' ? 'oldest-first' : 'newest-first',
      catalogStage: stages.includes(record.catalogStage as CatalogStage)
        ? (record.catalogStage as CatalogStage)
        : 'statuses',
      catalogIndex:
        typeof record.catalogIndex === 'number' &&
        Number.isInteger(record.catalogIndex) &&
        record.catalogIndex >= 0
          ? record.catalogIndex
          : 0,
      totalItems:
        typeof record.totalItems === 'number' && record.totalItems >= 0
          ? record.totalItems
          : 0,
      completedItems:
        typeof record.completedItems === 'number' && record.completedItems >= 0
          ? record.completedItems
          : 0,
      skippedItems:
        typeof record.skippedItems === 'number' && record.skippedItems >= 0
          ? record.skippedItems
          : 0,
      continuationCount:
        typeof record.continuationCount === 'number' &&
        Number.isInteger(record.continuationCount) &&
        record.continuationCount >= 0
          ? record.continuationCount
          : 0,
      ...(record.selectedOptions && typeof record.selectedOptions === 'object'
        ? {
            selectedOptions:
              record.selectedOptions as AccountImportProgress['selectedOptions']
          }
        : null)
    }
  } catch {
    return createInitialImportProgress()
  }
}

export const serializeImportProgress = (progress: AccountImportProgress) =>
  JSON.stringify(progress)

export const parseImportCursor = (value: string | null | undefined) => {
  if (!value) return { afterPosition: null }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return { afterPosition: null }
    const after = (parsed as Record<string, unknown>).afterPosition
    return {
      afterPosition:
        typeof after === 'number' && Number.isInteger(after) ? after : null
    }
  } catch {
    return { afterPosition: null }
  }
}

export const serializeImportCursor = (afterPosition: number | null) =>
  JSON.stringify({ afterPosition })

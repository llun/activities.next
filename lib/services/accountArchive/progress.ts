import { createHash } from 'crypto'

import type { ArchiveActorPlan } from './layout'
import type { ArchiveObjectStore } from './objectStore'
import { getArchiveStorageKey } from './objectStore'

/** What a run counted for one actor, for the manifest. */
export interface ArchiveActorStats {
  statuses: number
  likes: number
  bookmarks: number
  medias: number
  fitnessFiles: number
  follows: number
  followers: number
}

export const emptyActorStats = (): ArchiveActorStats => ({
  statuses: 0,
  likes: 0,
  bookmarks: 0,
  medias: 0,
  fitnessFiles: 0,
  follows: 0,
  followers: 0
})

/** One staged document: how many parts it has and how many items they hold. */
export interface StagedEntry {
  parts: number
  items: number
}

/**
 * The cursor `ExportAccountArchiveJob` persists in `account_archives.progress`
 * between slices. It stays small on purpose (it is rewritten after every page):
 * the staged documents' bytes live in object storage, only their part counts
 * live here.
 */
export interface ArchiveProgress {
  version: 1
  phase: 'collect' | 'assemble'
  /** The actors, planned once when the export starts. */
  actors: ArchiveActorPlan[]
  /** Index into `actors` of the actor being collected. */
  actorIndex: number
  /** Index into the collector steps of the current actor. */
  step: number
  /** The current step's own cursor (opaque to everything but that step). */
  cursor: unknown
  /** Staged documents by archive entry name, in the order they were started. */
  entries: Record<string, StagedEntry>
  /** How many parts of the file index (media and fitness files to copy). */
  fileParts: number
  stats: ArchiveActorStats[]
  warnings: string[]
  /** Slices started, which is also the number a duplicate message is compared to. */
  slice: number
  /** Consecutive slices that threw. */
  failures: number
  startedAt: number
  /** When the cursor was last saved; the stuck-export reaper reads it. */
  updatedAt?: number
}

export const createInitialProgress = ({
  actors,
  now
}: {
  actors: ArchiveActorPlan[]
  now: number
}): ArchiveProgress => ({
  version: 1,
  phase: 'collect',
  actors,
  actorIndex: 0,
  step: 0,
  cursor: null,
  entries: {},
  fileParts: 0,
  stats: actors.map(emptyActorStats),
  warnings: [],
  slice: 0,
  failures: 0,
  startedAt: now,
  updatedAt: now
})

export const parseProgress = (value: string | null): ArchiveProgress | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ArchiveProgress
    if (parsed?.version !== 1 || !Array.isArray(parsed.actors)) return null
    return parsed
  } catch {
    return null
  }
}

export const serializeProgress = (progress: ArchiveProgress) =>
  JSON.stringify(progress)

const entryKeyName = (entry: string) =>
  createHash('sha256').update(entry).digest('hex').slice(0, 24)

/** The object key of part `index` of a staged document. */
export const getPartKey = (archiveId: string, entry: string, index: number) =>
  getArchiveStorageKey(archiveId, 'stage', `${entryKeyName(entry)}-${index}`)

export const getFileIndexKey = (archiveId: string, index: number) =>
  getArchiveStorageKey(archiveId, 'stage', `files-${index}`)

export const getDraftsKey = (archiveId: string) =>
  getArchiveStorageKey(archiveId, 'stage', 'drafts.json')

export const getArchiveFileKey = (archiveId: string) =>
  getArchiveStorageKey(archiveId, 'archive.zip')

/**
 * Writes the documents' parts. The key of a part is a function of the entry and
 * of how many parts the persisted cursor already counts, so a slice that is cut
 * off after writing a part but before saving the cursor writes the same bytes
 * to the same key when it runs again: nothing is duplicated, nothing is lost.
 */
export class PartStager {
  constructor(
    private readonly store: ArchiveObjectStore,
    private readonly archiveId: string,
    private readonly progress: ArchiveProgress
  ) {}

  private entry(name: string): StagedEntry {
    return (this.progress.entries[name] ??= { parts: 0, items: 0 })
  }

  /** Stages raw text as the next part of `entry`. */
  async append(entry: string, text: string, items = 0) {
    const state = this.entry(entry)
    await this.store.put(getPartKey(this.archiveId, entry, state.parts), text)
    state.parts += 1
    state.items += items
  }

  /** Stages the items as comma-joined JSON, with the separator a later part needs. */
  async appendJsonItems(entry: string, items: unknown[]) {
    if (items.length === 0) return
    const state = this.entry(entry)
    const text = items.map((item) => JSON.stringify(item)).join(',')
    await this.append(entry, state.items > 0 ? `,${text}` : text, items.length)
  }

  /** Stages the items as JSON lines. */
  async appendJsonLines(entry: string, items: unknown[]) {
    if (items.length === 0) return
    await this.append(
      entry,
      `${items.map((item) => JSON.stringify(item)).join('\n')}\n`,
      items.length
    )
  }

  /** Items staged into `entry` so far. */
  count(entry: string) {
    return this.progress.entries[entry]?.items ?? 0
  }

  /** Makes sure an (empty) document exists, so the entry is in the archive. */
  touch(entry: string) {
    this.entry(entry)
  }

  async stageFiles(
    files: { entry: string; kind: 'media' | 'fitness'; path: string }[]
  ) {
    if (files.length === 0) return
    await this.store.put(
      getFileIndexKey(this.archiveId, this.progress.fileParts),
      `${files.map((file) => JSON.stringify({ e: file.entry, k: file.kind, p: file.path })).join('\n')}\n`
    )
    this.progress.fileParts += 1
  }
}

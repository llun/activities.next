import { createHash } from 'crypto'
import { deflateRawSync, constants as zlibConstants } from 'zlib'

import type { ArchiveActorPlan } from './layout'
import type { ArchiveObjectStore } from './objectStore'
import { getArchiveStorageKey } from './objectStore'
import { updateCrc } from './zipFormat'

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

/**
 * One staged document. Each part is deflated on its own when it is staged
 * (`PartStager.append`), so the archive copies the bytes as they are and the
 * entry's sizes and CRC-32 are known before its header is written.
 */
export interface StagedEntry {
  parts: number
  items: number
  /** Deflated length of each part, to resume inside the entry by offset. */
  sizes: number[]
  /** The writer of each part: the part's key has it in, see `writerOf`. */
  writers: string[]
  /** Uncompressed length of the whole document. */
  size: number
  /** CRC-32 of the whole document. */
  crc: number
}

/** The final empty deflate block that closes the concatenated parts. */
export const DEFLATE_END = Buffer.from([0x03, 0x00])

/** Compressed length of a staged document, the closing block included. */
export const stagedCompressedSize = (entry: StagedEntry) =>
  entry.sizes.reduce((total, size) => total + size, 0) + DEFLATE_END.length

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
  /** The writer of each file index part (its key has it in). */
  fileWriters: string[]
  stats: ArchiveActorStats[]
  warnings: string[]
  /**
   * The last run (a message's number) that finished and handed the export on.
   * Message `n` is current only while `completed === n - 1`: a duplicate of a
   * finished run is dropped, a retry of an unfinished one runs, and the next
   * message's id is derived from the number, so an id that was consumed is
   * never published again.
   */
  completed: number
  /** Consecutive slices that threw. */
  failures: number
  startedAt: number
  /**
   * The worker running a slice. A delivery that finds a live lease held by
   * another worker fails with a retryable error, so the queue delivers it again
   * once the lease lapses; the holder clears it when its slice ends.
   */
  lease: { token: string; until: number } | null
  /** Where the zip is being written; null until collection is done. */
  assembly: AssemblyState | null
}

/** The resumable state of the streaming zip writer. */
export interface AssemblyState {
  /** Names this attempt's output key; a new attempt gets a new key. */
  attempt: string
  key: string
  /** What the object store needs to reopen the output; null before it exists. */
  sink: Record<string, unknown> | null
  stage: 'entries' | 'extras' | 'files' | 'manifest' | 'central' | 'finish'
  /** Position inside the stage: an entry index, extras index or file line. */
  item: number
  /** File index position: [part, line]. */
  fileCursor: [number, number]
  /** The entry being written, when a slice stopped inside one. */
  entry: {
    name: string
    headerOffset: number
    /** Bytes of the entry's data written (after its header). */
    written: number
    /** Running CRC-32 of a streamed entry; unused by a known one. */
    crc: number
  } | null
  /** Bytes of the zip written so far (the next entry's header offset). */
  offset: number
  /** Staged central directory parts, and the entries they hold. */
  directoryParts: number
  /** The writer of each directory part and of its names part. */
  directoryWriters: string[]
  /** Generated documents already built, by entry name: their writer. */
  generated: Record<string, string>
  directoryEntries: number
  /** Position while the central directory is copied out. */
  directoryCopied: number
  /** Where the central directory starts, once it is being written. */
  directoryOffset?: number
  filesCopied: number
  filesSkipped: number
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
  fileWriters: [],
  stats: actors.map(emptyActorStats),
  warnings: [],
  completed: -1,
  failures: 0,
  startedAt: now,
  lease: null,
  assembly: null
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

/**
 * Names the worker that writes a staged object: the first bytes of its slice
 * token, which is unique to a delivery. Every key a worker writes and the
 * cursor later relies on has its writer in it and the cursor records the
 * writer, so a worker that stalled past its lease and writes late can only
 * create a key that nothing references. Such orphans are removed with the
 * archive's prefix when it finishes, fails or expires.
 */
export const writerOf = (token: string) => token.slice(0, 8)

/** The object key of part `index` of a staged document. */
export const getPartKey = (
  root: string,
  entry: string,
  index: number,
  writer: string
) =>
  getArchiveStorageKey(
    root,
    'stage',
    `${entryKeyName(entry)}-${index}.${writer}`
  )

export const getFileIndexKey = (root: string, index: number, writer: string) =>
  getArchiveStorageKey(root, 'stage', `files-${index}.${writer}`)

export const getDraftsKey = (root: string) =>
  getArchiveStorageKey(root, 'stage', 'drafts.json')

export const getArchiveFileKey = (root: string, attempt: string) =>
  getArchiveStorageKey(root, `archive-${attempt}.zip`)

export const getDirectoryPartKey = (
  root: string,
  index: number,
  writer: string
) => getArchiveStorageKey(root, 'stage', `directory-${index}.${writer}`)

/** Eight-byte hashes of the entry names in directory part `index`. */
export const getNamesPartKey = (root: string, index: number, writer: string) =>
  getArchiveStorageKey(root, 'stage', `names-${index}.${writer}`)

/** A small document built during assembly, kept so a resume reads the same bytes. */
export const getGeneratedKey = (root: string, entry: string, writer: string) =>
  getArchiveStorageKey(
    root,
    'stage',
    `generated-${entryKeyName(entry)}.${writer}`
  )

/**
 * Writes the documents' parts. The key of a part has the entry, the part's
 * number and the writer in it, and the cursor that counts the part records the
 * writer, so only the part the saved cursor names is ever read. A slice that is
 * cut off after writing a part but before saving the cursor leaves an orphan
 * that the run which redoes the page does not read (it writes under its own
 * writer), and a stalled worker that writes late cannot replace a part the new
 * owner already counted.
 */
export class PartStager {
  constructor(
    private readonly store: ArchiveObjectStore,
    private readonly root: string,
    private readonly progress: ArchiveProgress,
    private readonly writer: string,
    /** Called before each write; throws when the worker's lease has run out. */
    private readonly assertLeased: () => void = () => undefined
  ) {}

  private entry(name: string): StagedEntry {
    return (this.progress.entries[name] ??= {
      parts: 0,
      items: 0,
      sizes: [],
      writers: [],
      size: 0,
      crc: 0
    })
  }

  /** Stages raw text as the next part of `entry`. */
  async append(entry: string, text: string, items = 0) {
    const state = this.entry(entry)
    const raw = Buffer.from(text, 'utf8')
    // A full flush byte-aligns the output and starts the next part with no
    // history, so parts concatenate into one deflate stream (closed by
    // DEFLATE_END) and nothing about the compressor has to survive a slice.
    const packed = deflateRawSync(raw, {
      finishFlush: zlibConstants.Z_FULL_FLUSH
    })
    this.assertLeased()
    await this.store.put(
      getPartKey(this.root, entry, state.parts, this.writer),
      packed
    )
    state.parts += 1
    state.writers.push(this.writer)
    state.items += items
    state.sizes.push(packed.length)
    state.size += raw.length
    state.crc = updateCrc(state.crc, raw)
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
    this.assertLeased()
    await this.store.put(
      getFileIndexKey(this.root, this.progress.fileParts, this.writer),
      `${files.map((file) => JSON.stringify({ e: file.entry, k: file.kind, p: file.path })).join('\n')}\n`
    )
    this.progress.fileParts += 1
    this.progress.fileWriters.push(this.writer)
  }
}

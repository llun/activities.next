import { randomBytes } from 'crypto'

import { getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import {
  type AccountArchive,
  getArchiveStorageRoot
} from '@/lib/types/domain/accountArchive'

import {
  ARCHIVE_EXTRAS_DIR,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MAX_WARNINGS
} from './constants'
import { getMastodonCsvEntries } from './csvHook'
import { entryPath, toSafeEntryName } from './layout'
import type { ArchiveObjectStore, ResumableSink } from './objectStore'
import {
  type ArchiveProgress,
  type AssemblyState,
  getArchiveFileKey,
  getDirectoryPartKey,
  getDraftsKey,
  getFileIndexKey,
  getPartKey
} from './progress'
import type { ProgressSaver } from './saver'
import {
  type SourceKind,
  describeSourceFailure,
  openSourceFile
} from './sourceFiles'
import {
  type DosDateTime,
  buildCentralRecord,
  buildDataDescriptor,
  buildEndRecords,
  buildLocalHeader,
  readCentralNames,
  toDosDateTime,
  updateCrc
} from './zipFormat'

export type AssemblyOutcome =
  { done: false } | { done: true; key: string; bytes: number }

/** The manifest closes the archive; it sits beside the other extras. */
export const MANIFEST_ENTRY = entryPath(ARCHIVE_EXTRAS_DIR, 'manifest.json')
const ACCOUNT_ENTRY = entryPath(ARCHIVE_EXTRAS_DIR, 'account.json')
const DRAFTS_ENTRY = entryPath(ARCHIVE_EXTRAS_DIR, 'drafts.json')

/** A cursor is saved at least this often while a slice writes. */
const CHECKPOINT_INTERVAL_MS = 30 * 1000
/** The directory records buffered in memory before they are staged. */
const DIRECTORY_FLUSH_BYTES = 1024 * 1024

const newAssembly = (root: string): AssemblyState => {
  const attempt = randomBytes(8).toString('hex')
  return {
    attempt,
    key: getArchiveFileKey(root, attempt),
    sink: null,
    stage: 'entries',
    item: 0,
    fileCursor: [0, 0],
    entry: null,
    offset: 0,
    directoryParts: 0,
    directoryEntries: 0,
    directoryCopied: 0,
    filesCopied: 0,
    filesSkipped: 0
  }
}

/** Staged documents in archive order: Mastodon-shaped files, then the extras. */
const orderStagedEntries = (progress: ArchiveProgress) => {
  const extrasPrefix = `${ARCHIVE_EXTRAS_DIR}/`
  const names = Object.keys(progress.entries)
  return [
    ...names.filter((name) => !name.startsWith(extrasPrefix)),
    ...names.filter((name) => name.startsWith(extrasPrefix))
  ]
}

type ChunkSource = (from: number) => AsyncIterable<Buffer>

const fromBuffer = (data: Buffer): ChunkSource =>
  async function* (from) {
    if (data.length > from) yield data.subarray(from)
  }

/** Reads and discards `from` bytes of a stream the source cannot seek in. */
const fromStream = (
  open: () => Promise<AsyncIterable<Buffer | string>>
): ChunkSource =>
  async function* (from) {
    let skip = from
    for await (const piece of await open()) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece)
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      yield chunk.subarray(skip)
      skip = 0
    }
  }

/**
 * Writes the zip for a collected export, as far as the time budget allows.
 *
 * The output is resumable (see zipFormat.ts and `ResumableSink`): every entry
 * is stored, and the cursor holds the byte offset, the running CRC of the entry
 * in flight and the object store's own state, so a later slice, possibly on
 * another worker, continues where this one stopped. The cursor is saved with a
 * compare-and-set, so a worker that lost its lease finds out at its next save.
 * An attempt writes to its own key and nothing here deletes another attempt's
 * file.
 */
export const runAssemblySlice = async ({
  database,
  archive,
  store,
  saver,
  deadline,
  now = Date.now
}: {
  database: Database
  archive: AccountArchive
  store: ArchiveObjectStore
  saver: ProgressSaver
  /** Epoch milliseconds after which the slice stops at the next safe point. */
  deadline: number
  now?: () => number
}): Promise<AssemblyOutcome> => {
  const progress = saver.progress
  const root = getArchiveStorageRoot(archive)
  const dos: DosDateTime = toDosDateTime(progress.startedAt)
  progress.assembly ??= newAssembly(root)
  const assembly = progress.assembly

  const warn = (message: string) => {
    if (progress.warnings.length < ARCHIVE_MAX_WARNINGS) {
      progress.warnings.push(message)
    }
  }

  // A finished attempt whose `ready` update did not land: the file is there.
  if (assembly.stage === 'finish') {
    const size = await store.size(assembly.key)
    if (size !== null) return { done: true, key: assembly.key, bytes: size }
  }

  const sink: ResumableSink = await store.openResumableWrite(
    assembly.key,
    assembly.sink
  )

  let directoryBuffer: Buffer[] = []
  let directoryBufferBytes = 0
  let names: Set<string> | null = null
  const order: string[] = []
  let lastCheckpoint = now()
  let didWork = false

  const loadNames = async () => {
    if (names) return names
    names = new Set()
    for (let index = 0; index < assembly.directoryParts; index += 1) {
      const part = await store.get(getDirectoryPartKey(root, index))
      if (!part) throw new Error('A staged directory part is missing')
      for (const name of readCentralNames(part)) {
        names.add(name.toLowerCase())
        order.push(name)
      }
    }
    return names
  }

  const claim = async (name: string) => {
    const known = await loadNames()
    const key = name.toLowerCase()
    if (known.has(key)) return false
    known.add(key)
    return true
  }

  const put = async (chunk: Buffer) => {
    await sink.write(chunk)
    assembly.offset += chunk.length
  }

  const flushDirectory = async () => {
    if (directoryBuffer.length === 0) return
    await store.put(
      getDirectoryPartKey(root, assembly.directoryParts),
      Buffer.concat(directoryBuffer)
    )
    assembly.directoryParts += 1
    directoryBuffer = []
    directoryBufferBytes = 0
  }

  const checkpoint = async () => {
    await flushDirectory()
    assembly.sink = await sink.checkpoint()
    await saver.save()
    lastCheckpoint = now()
  }

  // Names of every entry written so far, for dedupe and the manifest.
  await loadNames()

  const shouldStop = () => didWork && now() >= deadline

  const writeEntry = async (name: string, source: ChunkSource) => {
    let entry = assembly.entry
    if (!entry) {
      entry = {
        name,
        headerOffset: assembly.offset,
        written: 0,
        crc: 0
      }
      assembly.entry = entry
      await put(buildLocalHeader(name, dos))
    }
    let stopped = false
    for await (const chunk of source(entry.written)) {
      await put(chunk)
      entry.written += chunk.length
      entry.crc = updateCrc(entry.crc, chunk)
      didWork = true
      if (now() >= deadline) {
        stopped = true
        break
      }
      if (now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) await checkpoint()
    }
    if (stopped) return false

    await put(buildDataDescriptor(entry.crc, entry.written))
    const record = buildCentralRecord({
      name,
      crc: entry.crc,
      size: entry.written,
      headerOffset: entry.headerOffset,
      dos
    })
    directoryBuffer.push(record)
    directoryBufferBytes += record.length
    assembly.directoryEntries += 1
    order.push(name)
    ;(await loadNames()).add(name.toLowerCase())
    assembly.entry = null
    didWork = true
    if (directoryBufferBytes >= DIRECTORY_FLUSH_BYTES) await flushDirectory()
    return true
  }

  /** Runs the loop; returns true when the slice must stop for time. */
  try {
    // Mastodon-shaped and extra documents staged during collection.
    if (assembly.stage === 'entries') {
      const staged = orderStagedEntries(progress)
      while (assembly.item < staged.length) {
        if (!assembly.entry && shouldStop()) {
          await checkpoint()
          return { done: false }
        }
        const name = staged[assembly.item]
        const parts = progress.entries[name].parts
        if (assembly.entry || (await claim(name))) {
          const finished = await writeEntry(
            name,
            parts === 0
              ? fromBuffer(Buffer.alloc(0))
              : async function* (from) {
                  let skip = from
                  for (let index = 0; index < parts; index += 1) {
                    const part = await store.get(getPartKey(root, name, index))
                    if (!part) throw new Error('A staged part is missing')
                    if (skip >= part.length) {
                      skip -= part.length
                      continue
                    }
                    yield part.subarray(skip)
                    skip = 0
                  }
                }
          )
          if (!finished) {
            await checkpoint()
            return { done: false }
          }
        }
        assembly.item += 1
      }
      assembly.stage = 'extras'
      assembly.item = 0
    }

    if (assembly.stage === 'extras') {
      const defaultActor =
        progress.actors.find((actor) => actor.isDefault) ?? progress.actors[0]
      const extras: {
        name: string
        source: () => Promise<ChunkSource | null>
      }[] = [
        ...getMastodonCsvEntries().map((csv) => ({
          name: csv.name,
          source: async () => {
            const content = await csv.open({
              database,
              accountId: archive.accountId,
              actor: defaultActor
            })
            return typeof content === 'string'
              ? fromBuffer(Buffer.from(content))
              : fromStream(async () => content)
          }
        }))
      ]
      if (archive.options.drafts) {
        extras.push({
          name: DRAFTS_ENTRY,
          source: async () => {
            const drafts = await store.get(getDraftsKey(root))
            if (!drafts) {
              warn('The drafts sent with the request were not found')
              return null
            }
            return fromBuffer(drafts)
          }
        })
      }
      extras.push({
        name: ACCOUNT_ENTRY,
        source: async () => {
          const account = await database.getAccountExportAccount({
            accountId: archive.accountId
          })
          return fromBuffer(
            Buffer.from(
              `${JSON.stringify(
                {
                  version: ARCHIVE_FORMAT_VERSION,
                  ...account,
                  actors: progress.actors.map((actor) => ({
                    id: actor.id,
                    username: actor.username,
                    domain: actor.domain,
                    isDefault: actor.isDefault,
                    directory: actor.dir
                  }))
                },
                null,
                2
              )}\n`
            )
          )
        }
      })

      while (assembly.item < extras.length) {
        if (!assembly.entry && shouldStop()) {
          await checkpoint()
          return { done: false }
        }
        const extra = extras[assembly.item]
        if (assembly.entry || (await claim(extra.name))) {
          const source = await extra.source()
          if (source) {
            const finished = await writeEntry(extra.name, source)
            if (!finished) {
              await checkpoint()
              return { done: false }
            }
          }
        }
        assembly.item += 1
      }
      assembly.stage = 'files'
      assembly.item = 0
    }

    if (assembly.stage === 'files') {
      // The index part being walked is read once, not once per file.
      type IndexLines = { e: string; k: SourceKind; p: string }[]
      let loaded = null as { index: number; lines: IndexLines } | null
      for (;;) {
        const [partIndex, lineIndex] = assembly.fileCursor
        if (partIndex >= progress.fileParts) break
        if (!loaded || loaded.index !== partIndex) {
          const body = await store.get(getFileIndexKey(root, partIndex))
          loaded = {
            index: partIndex,
            lines: (body?.toString('utf8') ?? '')
              .split('\n')
              .filter(Boolean)
              .map(
                (line) =>
                  JSON.parse(line) as { e: string; k: SourceKind; p: string }
              )
          }
        }
        const lines = loaded.lines
        if (lineIndex >= lines.length) {
          assembly.fileCursor = [partIndex + 1, 0]
          continue
        }
        if (!assembly.entry && shouldStop()) {
          await checkpoint()
          return { done: false }
        }
        const file = lines[lineIndex]
        const name = toSafeEntryName(file.e)
        const advance = () => {
          assembly.fileCursor = [partIndex, lineIndex + 1]
        }
        if (!name) {
          assembly.filesSkipped += 1
          warn('A file with an unsafe path was left out of the archive')
          advance()
          continue
        }
        const resuming = assembly.entry?.name === name
        if (!resuming && !(await claim(name))) {
          advance()
          continue
        }
        const outcome = await openSourceFile(
          file.k,
          file.p,
          resuming ? assembly.entry!.written : 0
        )
        if (!outcome.ok) {
          if (resuming) {
            throw new Error('A file vanished while it was being copied')
          }
          assembly.filesSkipped += 1
          warn(`${name} was left out: ${describeSourceFailure(outcome.reason)}`)
          advance()
          continue
        }
        const finished = await writeEntry(name, async function* () {
          for await (const chunk of outcome.file.stream) {
            yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          }
        })
        if (!finished) {
          outcome.file.stream.destroy()
          await checkpoint()
          return { done: false }
        }
        assembly.filesCopied += 1
        advance()
      }
      assembly.stage = 'manifest'
    }

    if (assembly.stage === 'manifest') {
      const account = await database.getAccountExportAccount({
        accountId: archive.accountId
      })
      await loadNames()
      const manifest = {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_FORMAT_VERSION,
        exportedAt: new Date(now()).toISOString(),
        startedAt: new Date(progress.startedAt).toISOString(),
        server: getConfig().host,
        account: account
          ? {
              id: account.id,
              signUpDomain: account.signUpDomain,
              defaultActorId: account.defaultActorId
            }
          : null,
        options: archive.options,
        actors: progress.actors.map((actor, index) => ({
          id: actor.id,
          handle: `@${actor.username}@${actor.domain}`,
          username: actor.username,
          domain: actor.domain,
          isDefault: actor.isDefault,
          directory: actor.dir,
          mastodonDirectory: actor.mastodonDir,
          counts: progress.stats[index]
        })),
        files: {
          copied: assembly.filesCopied,
          skipped: assembly.filesSkipped
        },
        entries: [...order],
        warnings: progress.warnings
      }
      if (assembly.entry || (await claim(MANIFEST_ENTRY))) {
        const finished = await writeEntry(
          MANIFEST_ENTRY,
          fromBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
        )
        if (!finished) {
          await checkpoint()
          return { done: false }
        }
      }
      await flushDirectory()
      assembly.stage = 'central'
      assembly.item = 0
      assembly.directoryCopied = 0
      assembly.directoryOffset = assembly.offset
    }

    if (assembly.stage === 'central') {
      while (assembly.directoryCopied < assembly.directoryParts) {
        if (shouldStop()) {
          await checkpoint()
          return { done: false }
        }
        const part = await store.get(
          getDirectoryPartKey(root, assembly.directoryCopied)
        )
        if (!part) throw new Error('A staged directory part is missing')
        await put(part)
        assembly.directoryCopied += 1
        didWork = true
      }
      await put(
        buildEndRecords({
          entries: assembly.directoryEntries,
          directoryOffset: assembly.directoryOffset ?? 0,
          directorySize: assembly.offset - (assembly.directoryOffset ?? 0)
        })
      )
      assembly.stage = 'finish'
      await checkpoint()
    }

    const bytes = await sink.finish()
    return { done: true, key: assembly.key, bytes }
  } catch (error) {
    await sink.release().catch(() => undefined)
    throw error
  } finally {
    // After `finish` the sink is closed already; releasing twice is harmless.
    await sink.release().catch(() => undefined)
  }
}

/** Throws away an unfinished output (a failed export's multipart upload). */
export const abortAssembly = async (
  store: ArchiveObjectStore,
  progress: ArchiveProgress | null
) => {
  const assembly = progress?.assembly
  if (!assembly || !assembly.sink) return
  const sink = await store.openResumableWrite(assembly.key, assembly.sink)
  await sink.abort()
}

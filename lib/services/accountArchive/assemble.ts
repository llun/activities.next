import { createHash, randomBytes } from 'crypto'
import { crc32 } from 'zlib'

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
import { entryPath, toSafeEntryName } from './layout'
import type { ArchiveObjectStore, ResumableSink } from './objectStore'
import {
  type ArchiveProgress,
  type AssemblyState,
  DEFLATE_END,
  type StagedEntry,
  getArchiveFileKey,
  getDirectoryPartKey,
  getDraftsKey,
  getFileIndexKey,
  getGeneratedKey,
  getNamesPartKey,
  getPartKey,
  stagedCompressedSize,
  writerOf
} from './progress'
import type { ProgressSaver } from './saver'
import {
  type SourceKind,
  describeSourceFailure,
  openSourceFile,
  readWithIdleTimeout
} from './sourceFiles'
import {
  type DosDateTime,
  type KnownEntry,
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
    directoryWriters: [],
    generated: {},
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

/** Eight bytes of a name's hash: the dedupe set keeps these, not the names. */
const nameHash = (name: string) =>
  createHash('sha256').update(name.toLowerCase()).digest().subarray(0, 8)

type ChunkSource = (from: number) => AsyncIterable<Buffer>

const fromBuffer = (data: Buffer): ChunkSource =>
  async function* (from) {
    if (data.length > from) yield data.subarray(from)
  }

/**
 * Writes the zip for a collected export, as far as the time budget allows.
 *
 * The output is resumable (see zipFormat.ts and `ResumableSink`): the cursor
 * holds the byte offset, the running CRC of a streamed entry and the object
 * store's own state, so a later slice, possibly on another worker, continues
 * where this one stopped. The cursor is saved with a compare-and-set, so a
 * worker that lost its lease finds out at its next save. An attempt writes to
 * its own key and nothing here deletes another attempt's file.
 *
 * Staged documents were deflated part by part when they were staged, so they
 * are copied as they are and resumed by part and offset; the other entries
 * (small generated documents, files from storage) are stored.
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
  let nameBuffer: Buffer[] = []
  let names: Set<string> | null = null
  let lastCheckpoint = now()
  let didWork = false

  // The dedupe set holds eight-byte hashes of the names, read from the staged
  // name parts (a fraction of the directory's size) and only when a stage that
  // can collide asks for it.
  const loadNames = async () => {
    if (names) return names
    names = new Set()
    for (let index = 0; index < assembly.directoryParts; index += 1) {
      const part = await store.get(
        getNamesPartKey(root, index, assembly.directoryWriters[index])
      )
      if (!part) throw new Error('A staged name part is missing')
      for (let at = 0; at + 8 <= part.length; at += 8) {
        names.add(part.subarray(at, at + 8).toString('hex'))
      }
    }
    return names
  }

  const claim = async (name: string) => {
    const known = await loadNames()
    const key = nameHash(name).toString('hex')
    if (known.has(key)) return false
    known.add(key)
    return true
  }

  // Every write to a key that another worker could also write is checked
  // against this worker's own lease first (see `ProgressSaver.assertLeased`).
  const assertLeased = () => saver.assertLeased(now())
  // This worker's id in the keys it writes (see `writerOf`).
  const writer = writerOf(
    saver.progress.lease?.token ?? randomBytes(8).toString('hex')
  )

  const put = async (chunk: Buffer) => {
    assertLeased()
    await sink.write(chunk)
    assembly.offset += chunk.length
  }

  const flushDirectory = async () => {
    if (directoryBuffer.length === 0) return
    assertLeased()
    await store.put(
      getDirectoryPartKey(root, assembly.directoryParts, writer),
      Buffer.concat(directoryBuffer)
    )
    await store.put(
      getNamesPartKey(root, assembly.directoryParts, writer),
      Buffer.concat(nameBuffer)
    )
    assembly.directoryParts += 1
    assembly.directoryWriters.push(writer)
    directoryBuffer = []
    nameBuffer = []
    directoryBufferBytes = 0
  }

  const checkpoint = async () => {
    await flushDirectory()
    assertLeased()
    assembly.sink = await sink.checkpoint()
    await saver.save()
    // Only now may the sink drop what the previous saved state needed.
    await sink.committed()
    lastCheckpoint = now()
  }

  const shouldStop = () => didWork && now() >= deadline

  const completeEntry = async (
    name: string,
    crc: number,
    size: number,
    known?: KnownEntry
  ) => {
    const entry = assembly.entry!
    const record = buildCentralRecord({
      name,
      crc,
      size,
      headerOffset: entry.headerOffset,
      dos,
      known
    })
    directoryBuffer.push(record)
    nameBuffer.push(nameHash(name))
    directoryBufferBytes += record.length
    assembly.directoryEntries += 1
    ;(await loadNames()).add(nameHash(name).toString('hex'))
    assembly.entry = null
    didWork = true
    if (directoryBufferBytes >= DIRECTORY_FLUSH_BYTES) await flushDirectory()
  }

  /**
   * An entry whose sizes and CRC are known before it starts: no descriptor.
   * Returns false when the slice stopped inside it.
   */
  const writeKnown = async (
    name: string,
    known: KnownEntry,
    source: ChunkSource
  ) => {
    let entry = assembly.entry
    if (!entry) {
      entry = { name, headerOffset: assembly.offset, written: 0, crc: 0 }
      assembly.entry = entry
      await put(buildLocalHeader(name, dos, known))
    }
    for await (const chunk of source(entry.written)) {
      await put(chunk)
      entry.written += chunk.length
      didWork = true
      if (entry.written < known.csize) {
        if (now() >= deadline) return false
        if (now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
          await checkpoint()
        }
      }
    }
    if (entry.written !== known.csize) {
      throw new Error(`The staged data of ${name} does not match its size`)
    }
    await completeEntry(name, known.crc, known.size, known)
    return true
  }

  /**
   * An entry copied from storage: stored, with a descriptor, since its CRC is
   * only known at the end. Returns false when the slice stopped inside it.
   */
  const writeStreamed = async (name: string, source: ChunkSource) => {
    let entry = assembly.entry
    if (!entry) {
      entry = { name, headerOffset: assembly.offset, written: 0, crc: 0 }
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
    await completeEntry(name, entry.crc, entry.written)
    return true
  }

  /** A staged document: its deflated parts, then the closing empty block. */
  const writeStaged = (name: string, staged: StagedEntry) => {
    if (staged.parts === 0) {
      return writeKnown(
        name,
        { method: 0, crc: 0, size: 0, csize: 0 },
        fromBuffer(Buffer.alloc(0))
      )
    }
    return writeKnown(
      name,
      {
        method: 8,
        crc: staged.crc,
        size: staged.size,
        csize: stagedCompressedSize(staged)
      },
      async function* (from) {
        // Resume by part and offset: parts before the position are not read.
        let skip = from
        for (let index = 0; index < staged.parts; index += 1) {
          const length = staged.sizes[index]
          if (skip >= length) {
            skip -= length
            continue
          }
          const part = await store.get(
            getPartKey(root, name, index, staged.writers[index])
          )
          if (!part || part.length !== length) {
            throw new Error('A staged part is missing')
          }
          yield part.subarray(skip)
          skip = 0
        }
        if (skip < DEFLATE_END.length) yield DEFLATE_END.subarray(skip)
      }
    )
  }

  /** A small document made once and kept, so a resume reads the same bytes. */
  const writeGenerated = async (name: string, body: Buffer) =>
    writeKnown(
      name,
      { method: 0, crc: crc32(body), size: body.length, csize: body.length },
      fromBuffer(body)
    )

  const generated = async (name: string, build: () => Promise<Buffer>) => {
    // A document already built by an earlier slice is the one the cursor names.
    const keptBy = assembly.generated[name]
    if (keptBy) {
      const kept = await store.get(getGeneratedKey(root, name, keptBy))
      if (kept) return kept
    }
    const body = await build()
    assertLeased()
    await store.put(getGeneratedKey(root, name, writer), body)
    // Counted by the next cursor save, which also counts what it is used for.
    assembly.generated[name] = writer
    return body
  }

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
        if (assembly.entry || (await claim(name))) {
          const finished = await writeStaged(name, progress.entries[name])
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
      const extras: {
        name: string
        body: () => Promise<Buffer | null>
      }[] = []
      if (archive.options.drafts) {
        extras.push({
          name: DRAFTS_ENTRY,
          body: async () => {
            const drafts = await store.get(getDraftsKey(root))
            if (!drafts) {
              warn('The drafts sent with the request were not found')
            }
            return drafts
          }
        })
      }
      extras.push({
        name: ACCOUNT_ENTRY,
        body: () =>
          generated(ACCOUNT_ENTRY, async () => {
            const account = await database.getAccountExportAccount({
              accountId: archive.accountId
            })
            return Buffer.from(
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
          })
      })

      while (assembly.item < extras.length) {
        if (!assembly.entry && shouldStop()) {
          await checkpoint()
          return { done: false }
        }
        const extra = extras[assembly.item]
        if (assembly.entry || (await claim(extra.name))) {
          const body = await extra.body()
          if (body) {
            const finished = await writeGenerated(extra.name, body)
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
          const body = await store.get(
            getFileIndexKey(root, partIndex, progress.fileWriters[partIndex])
          )
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
        let finished: boolean
        try {
          finished = await writeStreamed(name, () =>
            readWithIdleTimeout(outcome.file.stream)
          )
        } catch (error) {
          // A failed write must not leave the source open (a socket or a file
          // handle) while the slice is retried.
          outcome.file.stream.destroy()
          throw error
        }
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
      if (assembly.entry || (await claim(MANIFEST_ENTRY))) {
        const body = await generated(MANIFEST_ENTRY, async () => {
          const account = await database.getAccountExportAccount({
            accountId: archive.accountId
          })
          await flushDirectory()
          const order: string[] = []
          for (let index = 0; index < assembly.directoryParts; index += 1) {
            const part = await store.get(
              getDirectoryPartKey(root, index, assembly.directoryWriters[index])
            )
            if (!part) throw new Error('A staged directory part is missing')
            order.push(...readCentralNames(part))
          }
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
            entries: order,
            warnings: progress.warnings
          }
          return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
        })
        const finished = await writeGenerated(MANIFEST_ENTRY, body)
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
          getDirectoryPartKey(
            root,
            assembly.directoryCopied,
            assembly.directoryWriters[assembly.directoryCopied]
          )
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

    assertLeased()
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
  // Needs neither the staged tail nor the part list to be readable: a failed
  // assembly is often one whose tail is gone.
  await store.abortResumableWrite(assembly.key, assembly.sink)
}

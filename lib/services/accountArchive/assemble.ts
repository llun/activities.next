import { Readable } from 'stream'

import type { Database } from '@/lib/database/types'
import type { AccountArchive } from '@/lib/types/domain/accountArchive'

import {
  ARCHIVE_EXTRAS_DIR,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MAX_WARNINGS
} from './constants'
import { getMastodonCsvEntries } from './csvHook'
import { entryPath, toSafeEntryName } from './layout'
import type { ArchiveObjectStore } from './objectStore'
import {
  type ArchiveProgress,
  getArchiveFileKey,
  getDraftsKey,
  getFileIndexKey,
  getPartKey
} from './progress'
import {
  type SourceKind,
  describeSourceFailure,
  openSourceFile
} from './sourceFiles'
import { createArchiveZip } from './zip'

export interface AssembleResult {
  key: string
  bytes: number
  warnings: string[]
}

const readIndexLines = async (
  store: ArchiveObjectStore,
  archiveId: string,
  parts: number
) => {
  const files: { e: string; k: SourceKind; p: string }[] = []
  for (let index = 0; index < parts; index += 1) {
    const body = await store.get(getFileIndexKey(archiveId, index))
    if (!body) continue
    for (const line of body.toString('utf8').split('\n')) {
      if (line) files.push(JSON.parse(line))
    }
  }
  return files
}

/** The staged documents' parts, one after the other, as one stream. */
const readStagedEntry = (
  store: ArchiveObjectStore,
  archiveId: string,
  entry: string,
  parts: number
) =>
  Readable.from(
    (async function* () {
      for (let index = 0; index < parts; index += 1) {
        const part = await store.get(getPartKey(archiveId, entry, index))
        if (!part) throw new Error('A staged part of the export is missing')
        yield part
      }
    })()
  )

/**
 * Builds the zip in one streaming pass: the Mastodon-shaped files first, then
 * the extras, then the stored files, with the manifest last. Only one source
 * file is open at a time and nothing but one staged part is held in memory.
 *
 * The file is written under a temporary name by the store and renamed when it is
 * complete, so a failed or repeated assembly never leaves a half archive that
 * looks finished.
 */
export const assembleArchive = async ({
  database,
  archive,
  store,
  progress,
  now = Date.now
}: {
  database: Database
  archive: AccountArchive
  store: ArchiveObjectStore
  progress: ArchiveProgress
  now?: () => number
}): Promise<AssembleResult> => {
  const key = getArchiveFileKey(archive.id)
  const zip = createArchiveZip(new Date(progress.startedAt))
  const sink = store.openWrite(key)
  zip.outputStream.pipe(sink.stream)
  const warnings = [...progress.warnings]
  const warn = (message: string) => {
    if (warnings.length < ARCHIVE_MAX_WARNINGS) warnings.push(message)
  }

  const written = new Set<string>()
  const claim = (name: string) => {
    const lower = name.toLowerCase()
    if (written.has(lower)) return false
    written.add(lower)
    return true
  }

  try {
    // Mastodon-shaped entries (outside activities.next/) before the extras.
    const extrasPrefix = `${ARCHIVE_EXTRAS_DIR}/`
    const names = Object.keys(progress.entries)
    const ordered = [
      ...names.filter((name) => !name.startsWith(extrasPrefix)),
      ...names.filter((name) => name.startsWith(extrasPrefix))
    ]
    const entryList: string[] = []
    for (const name of ordered) {
      const parts = progress.entries[name].parts
      if (!claim(name)) continue
      entryList.push(name)
      if (parts === 0) {
        zip.addBuffer(name, '')
        continue
      }
      await zip.addStream(name, readStagedEntry(store, archive.id, name, parts))
    }

    const defaultActor =
      progress.actors.find((actor) => actor.isDefault) ?? progress.actors[0]
    for (const csv of getMastodonCsvEntries()) {
      if (!claim(csv.name)) continue
      const content = await csv.open({
        database,
        accountId: archive.accountId,
        actor: defaultActor
      })
      entryList.push(csv.name)
      if (typeof content === 'string') zip.addBuffer(csv.name, content)
      else await zip.addStream(csv.name, content)
    }

    if (archive.options.drafts) {
      const drafts = await store.get(getDraftsKey(archive.id))
      const name = entryPath(ARCHIVE_EXTRAS_DIR, 'drafts.json')
      if (drafts && claim(name)) {
        zip.addBuffer(name, drafts)
        entryList.push(name)
      } else if (!drafts) {
        warn('The drafts sent with the request were not found')
      }
    }

    const accountName = entryPath(ARCHIVE_EXTRAS_DIR, 'account.json')
    const account = await database.getAccountExportAccount({
      accountId: archive.accountId
    })
    claim(accountName)
    zip.addBuffer(
      accountName,
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
    entryList.push(accountName)

    let fileCount = 0
    let missingCount = 0
    for (const file of await readIndexLines(
      store,
      archive.id,
      progress.fileParts
    )) {
      const name = toSafeEntryName(file.e)
      if (!name) {
        missingCount += 1
        warn('A file with an unsafe path was left out of the archive')
        continue
      }
      if (!claim(name)) continue
      const outcome = await openSourceFile(file.k, file.p)
      if (!outcome.ok) {
        missingCount += 1
        warn(`${name} was left out: ${describeSourceFailure(outcome.reason)}`)
        continue
      }
      // Images and videos are already compressed; fitness files are not. A
      // read that fails half way cannot be taken back out of the zip, so it
      // fails the assembly (the job retries it from the start).
      await zip.addStream(name, outcome.file.stream, {
        compress: file.k === 'fitness'
      })
      fileCount += 1
    }

    const manifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_FORMAT_VERSION,
      createdAt: new Date(now()).toISOString(),
      startedAt: new Date(progress.startedAt).toISOString(),
      options: archive.options,
      actors: progress.actors.map((actor, index) => ({
        username: actor.username,
        domain: actor.domain,
        isDefault: actor.isDefault,
        directory: actor.dir,
        mastodonDirectory: actor.mastodonDir,
        counts: progress.stats[index]
      })),
      files: { copied: fileCount, skipped: missingCount },
      entries: entryList,
      warnings
    }
    claim('manifest.json')
    zip.addBuffer('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
    zip.end()
    const bytes = await sink.done
    return { key, bytes, warnings }
  } catch (error) {
    zip.outputStream.unpipe(sink.stream)
    sink.stream.destroy()
    await sink.done.catch(() => undefined)
    await store.delete(key).catch(() => undefined)
    throw error
  }
}

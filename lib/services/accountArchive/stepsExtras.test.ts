import { iterateArrayItems } from '@/lib/services/accountImport/json/arrayItems'
import {
  ARCHIVE_URI_MAX_LENGTH,
  BOOKMARK_FOLDER_ENTRY_MAX_ITEMS,
  ownBookmarkFolderSchema
} from '@/lib/services/accountImport/schemas'
import { logger } from '@/lib/utils/logger'

import type { StepContext } from './steps.types'
import {
  BOOKMARK_FOLDER_ENTRY_MAX_BYTES,
  bookmarkFoldersStep,
  splitBookmarkFolder
} from './stepsExtras'

const folder = {
  id: 'folder-1',
  name: 'Birding',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000
}

// What the importer sees: the entries written as the archive writes them
// (`json()`), read back one array entry at a time.
const readBack = async (entries: Record<string, unknown>[]) => {
  const document = Buffer.from(`${JSON.stringify(entries, null, 2)}\n`)
  const events = []
  for await (const event of iterateArrayItems(
    (async function* () {
      yield document
    })()
  ))
    events.push(event)
  return events
}

describe('splitBookmarkFolder', () => {
  it('keeps a small folder as one entry', () => {
    expect(
      splitBookmarkFolder(folder, ['https://a.example/1']).entries
    ).toEqual([{ ...folder, items: ['https://a.example/1'] }])
    expect(splitBookmarkFolder(folder, []).entries).toEqual([
      { ...folder, items: [] }
    ])
  })

  it('splits a folder past the byte budget into same-name entries the importer reads whole', async () => {
    // ~10,000 URIs of varying length, well past one 512 KiB entry.
    const uris = Array.from(
      { length: 10_000 },
      (_, index) =>
        `https://remote.example/users/someone/statuses/${index}${'x'.repeat(index % 60)}`
    )

    const { entries } = splitBookmarkFolder(folder, uris)

    expect(entries.length).toBeGreaterThan(1)
    expect(entries.every((entry) => entry.name === 'Birding')).toBe(true)
    expect(entries.flatMap((entry) => entry.items as string[])).toEqual(uris)
    for (const event of await readBack(entries)) {
      if (!('raw' in event))
        throw new Error(`entry ${event.index}: ${event.error}`)
      expect(Buffer.byteLength(event.raw)).toBeLessThanOrEqual(
        BOOKMARK_FOLDER_ENTRY_MAX_BYTES
      )
      expect(
        ownBookmarkFolderSchema.safeParse(JSON.parse(event.raw)).success
      ).toBe(true)
    }
  })

  it('stays within the item cap however short the URIs are', () => {
    const uris = Array.from(
      { length: BOOKMARK_FOLDER_ENTRY_MAX_ITEMS + 1 },
      (_, index) => `u${index}`
    )

    const { entries } = splitBookmarkFolder(folder, uris)

    expect(entries.length).toBeGreaterThan(1)
    for (const entry of entries) {
      expect((entry.items as string[]).length).toBeLessThanOrEqual(
        BOOKMARK_FOLDER_ENTRY_MAX_ITEMS
      )
    }
  })

  it('leaves out a URI longer than the import accepts, and counts it', () => {
    const tooLong =
      'https://remote.example/' + 'x'.repeat(ARCHIVE_URI_MAX_LENGTH)
    const kept = 'https://remote.example/kept'

    const { entries, omitted } = splitBookmarkFolder(folder, [tooLong, kept])

    expect(omitted).toBe(1)
    expect(entries).toEqual([{ ...folder, items: [kept] }])
    expect(ownBookmarkFolderSchema.safeParse(entries[0]).success).toBe(true)
    expect(splitBookmarkFolder(folder, [kept]).omitted).toBe(0)
  })
})

describe('bookmarkFoldersStep', () => {
  const tooLong = (n: number) =>
    `https://remote.example/${n}/` + 'x'.repeat(ARCHIVE_URI_MAX_LENGTH)

  // Only what the step reads: the two export tables, the stage and warn.
  const run = async (uris: string[]) => {
    const rows: Record<string, Record<string, unknown>[]> = {
      bookmark_folders: [{ ...folder }],
      bookmark_folder_items: uris.map((statusId, index) => ({
        id: index + 1,
        statusId,
        folderId: folder.id
      }))
    }
    const append = vi.fn(async () => {})
    const warn = vi.fn()
    const context = {
      database: {
        getAccountExportRows: async ({ table }: { table: string }) => ({
          rows: rows[table] ?? [],
          next: null
        })
      },
      actor: { id: 'https://llun.test/users/owner', dir: 'activities.next' },
      stage: { append },
      pageSize: 100,
      warn
    } as unknown as StepContext
    await expect(bookmarkFoldersStep.run(context, null)).resolves.toBe('done')
    return { append, warn }
  }

  it('warns with a count of the URIs too long to import, and logs no URI', async () => {
    const logged = vi.spyOn(logger, 'warn')
    const long = [tooLong(1), tooLong(2)]

    const { append, warn } = await run([...long, 'https://remote.example/ok'])

    expect(warn).toHaveBeenCalledWith(
      "2 bookmarks couldn't be filed in their folders in bookmark_folders.json because their address is too long to import. They are still in bookmarks.json."
    )
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ omitted: 2 }))
    const logText = JSON.stringify(logged.mock.calls)
    for (const uri of long) expect(logText).not.toContain(uri)
    expect(logText).not.toContain('remote.example')
    const written = String((append.mock.calls[0] as unknown[])[1])
    expect(written).toContain('https://remote.example/ok')
    for (const uri of long) expect(written).not.toContain(uri)
    logged.mockRestore()
  })

  it('uses the singular for one, and warns about nothing when all fit', async () => {
    expect((await run([tooLong(1)])).warn).toHaveBeenCalledWith(
      "1 bookmark couldn't be filed in its folder in bookmark_folders.json because its address is too long to import. It is still in bookmarks.json."
    )
    expect(
      (await run(['https://remote.example/ok'])).warn
    ).not.toHaveBeenCalled()
  })
})

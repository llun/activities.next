import { iterateArrayItems } from '@/lib/services/accountImport/json/arrayItems'
import {
  ARCHIVE_URI_MAX_LENGTH,
  BOOKMARK_FOLDER_ENTRY_MAX_ITEMS,
  ownBookmarkFolderSchema
} from '@/lib/services/accountImport/schemas'

import {
  BOOKMARK_FOLDER_ENTRY_MAX_BYTES,
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

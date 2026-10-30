import { describe, expect, it } from 'vitest'

import { detectArchiveKind } from './detectArchiveKind'
import type { ZipCatalogEntry } from './zip/reader'

const entry = (name: string): ZipCatalogEntry => ({
  name,
  compressedSize: 10,
  uncompressedSize: 20,
  compressionMethod: 0
})

describe('detectArchiveKind', () => {
  it("recognises this server's own export", () => {
    const catalog = [
      entry('actor.json'),
      entry('outbox.json'),
      entry('activities.next/manifest.json'),
      entry('activities.next/statuses.jsonl')
    ]
    expect(detectArchiveKind(catalog)).toBe('activities.next')
  })

  it('does not take Mastodon-shaped files in a subfolder for a root export', () => {
    const catalog = [entry('subdir/actor.json'), entry('subdir/outbox.json')]
    expect(detectArchiveKind(catalog)).toBe('unrecognised')
  })
})

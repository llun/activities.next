import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'

import { type ZipOpenCaps, openZipArchive } from './reader'
import { buildZip, sourceOf } from './testing/fixtures'

const expectStreamFailure = async (
  archive: Awaited<ReturnType<typeof openZipArchive>>,
  entryName: string,
  reason: string
) => {
  let resolveUncaught!: (error: Error) => void
  const uncaught = new Promise<Error>((resolve) => {
    resolveUncaught = resolve
  })
  const onUncaught = (error: Error) => resolveUncaught(error)
  process.once('uncaughtException', onUncaught)
  try {
    const reading = (async () => {
      const stream = await archive.openEntryStream(entryName)
      for await (const _chunk of stream) {
        // Consume the stream so validation and inflater errors reach the caller.
      }
    })().then(
      () => ({ type: 'resolved' as const }),
      (error: unknown) => ({ type: 'rejected' as const, error })
    )
    const outcome = await Promise.race([
      reading,
      uncaught.then((error) => ({ type: 'uncaught' as const, error }))
    ])
    expect(outcome).toMatchObject({ type: 'rejected', error: { reason } })
  } finally {
    process.off('uncaughtException', onUncaught)
  }
}

describe('the zip reader', () => {
  it('opens an archive and lists every entry', async () => {
    const archive = buildZip([
      { name: 'actor.json', data: Buffer.from('{}') },
      { name: 'outbox.json', data: Buffer.from('[]') }
    ])
    const opened = await openZipArchive(sourceOf(archive))
    expect(opened.entries.map((entry) => entry.name)).toEqual([
      'actor.json',
      'outbox.json'
    ])
    await opened.close()
  })

  it('refuses an archive with an entry over the size cap', async () => {
    const archive = buildZip([
      { name: 'big.json', data: Buffer.alloc(32, 0x61) }
    ])
    const caps: Partial<ZipOpenCaps> = { maxEntrySize: 16 }
    await expect(openZipArchive(sourceOf(archive), caps)).rejects.toMatchObject(
      { reason: 'entry_too_large' }
    )
  })

  it('refuses an archive with too many entries', async () => {
    const entries = [
      { name: 'one.txt', data: Buffer.from('1') },
      { name: 'two.txt', data: Buffer.from('2') },
      { name: 'three.txt', data: Buffer.from('3') }
    ]
    const archive = buildZip(entries)
    await expect(
      openZipArchive(sourceOf(archive), { maxEntries: 2 })
    ).rejects.toMatchObject({ reason: 'too_many_entries' })
  })

  it('refuses an archive whose entries add up past the total cap', async () => {
    const archive = buildZip([
      { name: 'a.json', data: Buffer.alloc(64, 0x61) },
      { name: 'b.json', data: Buffer.alloc(64, 0x62) }
    ])
    await expect(
      openZipArchive(sourceOf(archive), { maxTotalUncompressed: 96 })
    ).rejects.toMatchObject({ reason: 'total_too_large' })
  })

  it('refuses an entry whose compression ratio breaks the cap', async () => {
    // The central record declares 40960 uncompressed bytes from 4096
    // compressed ones: a ratio of 10, over the cap of 4.
    const data = deflateRawSync(Buffer.alloc(4096, 0x61))
    const archive = buildZip([
      {
        name: 'ratio.json',
        data,
        method: 8,
        declaredSize: 40960,
        declaredCompressedSize: data.length
      }
    ])
    await expect(
      openZipArchive(sourceOf(archive), { maxCompressionRatio: 4 })
    ).rejects.toMatchObject({ reason: 'ratio_too_high' })
  })

  it('refuses an unsafe entry name', async () => {
    const archive = buildZip([
      { name: '../evil.json', data: Buffer.from('{}') }
    ])
    await expect(openZipArchive(sourceOf(archive))).rejects.toMatchObject({
      reason: 'unsafe_name'
    })
  })

  it('refuses bytes that are not a zip archive', async () => {
    await expect(
      openZipArchive(sourceOf(Buffer.from('not a zip at all')))
    ).rejects.toMatchObject({ reason: 'not_a_zip' })
  })

  it('reads a deflated entry back whole', async () => {
    const deflated = deflateRawSync(Buffer.from('{"id": 1}'))
    const archive = buildZip([
      {
        name: 'actor.json',
        data: deflated,
        method: 8,
        declaredSize: 9,
        declaredCompressedSize: deflated.length
      }
    ])
    const opened = await openZipArchive(sourceOf(archive))
    const stream = await opened.openEntryStream('actor.json')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString('utf8')).toBe('{"id": 1}')
    await opened.close()
  })

  it('rejects a corrupt deflated entry stream with a reason code', async () => {
    const archive = buildZip([
      {
        name: 'corrupt.json',
        data: Buffer.alloc(60, 0xff),
        method: 8,
        declaredSize: 100,
        declaredCompressedSize: 60
      }
    ])
    const opened = await openZipArchive(sourceOf(archive))
    try {
      await expectStreamFailure(opened, 'corrupt.json', 'not_a_zip')
    } finally {
      await opened.close()
    }
  })

  it('rejects a deflated entry stream that exceeds its declared byte limit', async () => {
    const compressed = deflateRawSync(Buffer.alloc(128, 0x61))
    const archive = buildZip([
      {
        name: 'oversized.json',
        data: compressed,
        method: 8,
        declaredSize: 8,
        declaredCompressedSize: compressed.length
      }
    ])
    const opened = await openZipArchive(sourceOf(archive))
    try {
      await expectStreamFailure(opened, 'oversized.json', 'entry_too_large')
    } finally {
      await opened.close()
    }
  })

  it('opens a two-thousand-entry archive with a small constant number of range reads', async () => {
    const archive = buildZip(
      Array.from({ length: 2000 }, (_, index) => ({
        name: `entry-${index}.txt`,
        data: Buffer.from('x')
      }))
    )
    let reads = 0
    const source = {
      size: archive.length,
      async read(start: number, endInclusive: number) {
        reads += 1
        return Buffer.from(archive.subarray(start, endInclusive + 1))
      }
    }
    const opened = await openZipArchive(source)
    try {
      expect(opened.entries).toHaveLength(2000)
      expect(reads).toBeLessThanOrEqual(4)
    } finally {
      await opened.close()
    }
  })

  it('passes a source error from open through unchanged', async () => {
    // A read the source refuses (a changed archive, a storage failure) is
    // not a defect of the zip bytes: it must surface as itself, never as
    // not_a_zip.
    const failure = new Error('archive changed underneath')
    const source = {
      size: 128,
      read: async () => {
        throw failure
      }
    }
    await expect(openZipArchive(source)).rejects.toBe(failure)
  })

  it('passes a source error from an entry stream through unchanged', async () => {
    // The entry data must span past the first read-ahead block (4 MiB), so
    // the local header read succeeds, the stream opens, and only the
    // entry's own data read fails.
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.concat([Buffer.from('{}'), Buffer.alloc(5 * 1024 * 1024)])
      }
    ])
    const failure = new Error('archive changed underneath')
    const source = {
      size: archive.length,
      read: async (start: number, endInclusive: number) => {
        if (start === 4 * 1024 * 1024) throw failure
        return Buffer.from(archive.subarray(start, endInclusive + 1))
      }
    }
    const opened = await openZipArchive(source)
    try {
      const stream = await opened.openEntryStream('actor.json')
      const drain = async () => {
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        return chunks
      }
      await expect(drain()).rejects.toBe(failure)
    } finally {
      await opened.close()
    }
  })
})

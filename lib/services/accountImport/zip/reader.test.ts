import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'

import { type ZipOpenCaps, openZipArchive } from './reader'
import { buildZip, sourceOf } from './testing/fixtures'

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

  it('cuts an entry stream off once it passes its declared size', async () => {
    const archive = buildZip([
      {
        name: 'lying.json',
        data: Buffer.alloc(128, 0x61),
        declaredSize: 8,
        declaredCompressedSize: 128
      }
    ])
    await expect(openZipArchive(sourceOf(archive))).rejects.toMatchObject({
      reason: 'entry_too_large'
    })
  })
})

/** @vitest-size large */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { constants, crc32, deflateRawSync } from 'zlib'

import {
  readZip,
  readZipStreaming,
  verifyZipWithTools
} from './testing/readZip'
import {
  buildCentralRecord,
  buildDataDescriptor,
  buildEndRecords,
  buildLocalHeader,
  readCentralNames,
  toDosDateTime,
  updateCrc
} from './zipFormat'

describe('resumable zip format', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-format-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const build = (entries: { name: string; chunks: Buffer[] }[]) => {
    const dos = toDosDateTime(Date.UTC(2026, 9, 24, 12, 30, 10))
    const pieces: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    const push = (piece: Buffer) => {
      pieces.push(piece)
      offset += piece.length
    }
    for (const entry of entries) {
      const headerOffset = offset
      push(buildLocalHeader(entry.name, dos))
      let crc = 0
      let size = 0
      for (const chunk of entry.chunks) {
        push(chunk)
        crc = updateCrc(crc, chunk)
        size += chunk.length
      }
      push(buildDataDescriptor(crc, size))
      central.push(
        buildCentralRecord({ name: entry.name, crc, size, headerOffset, dos })
      )
    }
    const directory = Buffer.concat(central)
    const directoryOffset = offset
    push(directory)
    push(
      buildEndRecords({
        entries: entries.length,
        directoryOffset,
        directorySize: directory.length
      })
    )
    return { zip: Buffer.concat(pieces), directory }
  }

  it('writes a zip that unzip, Python and yauzl read, with chunked entries', async () => {
    const big = Buffer.alloc(300_000)
    for (let index = 0; index < big.length; index += 1) big[index] = index % 251
    const { zip } = build([
      { name: 'a.txt', chunks: [Buffer.from('hello '), Buffer.from('world')] },
      { name: 'empty.json', chunks: [] },
      {
        name: 'dir/ünï.bin',
        chunks: [big.subarray(0, 1000), big.subarray(1000)]
      }
    ])
    const file = path.join(dir, 'out.zip')
    await fs.writeFile(file, zip)

    expect(verifyZipWithTools(file).length).toBeGreaterThan(0)
    const { names, files } = await readZip(file)
    expect(names).toEqual(['a.txt', 'empty.json', 'dir/ünï.bin'])
    expect(files.get('a.txt')?.toString()).toBe('hello world')
    expect(files.get('empty.json')?.length).toBe(0)
    expect(files.get('dir/ünï.bin')?.equals(big)).toBe(true)
  })

  it('keeps a running CRC equal to the CRC of the whole', () => {
    const data = Buffer.from('a resumable checksum')
    const split = updateCrc(updateCrc(0, data.subarray(0, 7)), data.subarray(7))
    expect(split).toBe(crc32(data))
  })

  it('reads the entry names back from the central records', () => {
    const { directory } = build([
      { name: 'one', chunks: [Buffer.from('1')] },
      { name: 'two/ü', chunks: [Buffer.from('2')] }
    ])
    expect(readCentralNames(directory)).toEqual(['one', 'two/ü'])
  })

  it('detects a corrupted entry (the test would otherwise prove nothing)', async () => {
    const { zip } = build([{ name: 'a.txt', chunks: [Buffer.from('hello')] }])
    const broken = Buffer.from(zip)
    broken[zip.indexOf('hello')] = 0x58
    const file = path.join(dir, 'broken.zip')
    await fs.writeFile(file, broken)
    expect(() => verifyZipWithTools(file)).toThrow()
  })

  it('writes known entries (stored and deflated by parts) with no descriptor, readable by a streaming reader', async () => {
    const dos = toDosDateTime(Date.UTC(2026, 9, 24))
    const pieces: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    const push = (piece: Buffer) => {
      pieces.push(piece)
      offset += piece.length
    }
    const texts = ['{"items":[', '"a","b"', '],"done":true}\n']
    const parts = texts.map((text) =>
      deflateRawSync(Buffer.from(text), {
        finishFlush: constants.Z_FULL_FLUSH
      })
    )
    const whole = Buffer.from(texts.join(''))
    const end = Buffer.from([3, 0])
    const csize = parts.reduce((sum, part) => sum + part.length, 0) + 2
    const deflated = {
      method: 8 as const,
      crc: crc32(whole),
      size: whole.length,
      csize
    }
    central.push(
      (() => {
        const headerOffset = offset
        push(buildLocalHeader('doc.json', dos, deflated))
        for (const part of parts) push(part)
        push(end)
        return buildCentralRecord({
          name: 'doc.json',
          crc: deflated.crc,
          size: deflated.size,
          headerOffset,
          dos,
          known: deflated
        })
      })()
    )
    const note = Buffer.from('plain note')
    const stored = {
      method: 0 as const,
      crc: crc32(note),
      size: note.length,
      csize: note.length
    }
    central.push(
      (() => {
        const headerOffset = offset
        push(buildLocalHeader('note.txt', dos, stored))
        push(note)
        return buildCentralRecord({
          name: 'note.txt',
          crc: stored.crc,
          size: stored.size,
          headerOffset,
          dos,
          known: stored
        })
      })()
    )
    const directory = Buffer.concat(central)
    const directoryOffset = offset
    push(directory)
    push(
      buildEndRecords({
        entries: 2,
        directoryOffset,
        directorySize: directory.length
      })
    )
    const file = path.join(dir, 'known.zip')
    await fs.writeFile(file, Buffer.concat(pieces))

    expect(verifyZipWithTools(file).length).toBeGreaterThan(0)
    const { files, methods } = await readZip(file)
    expect(files.get('doc.json')?.equals(whole)).toBe(true)
    expect(files.get('note.txt')?.toString()).toBe('plain note')
    expect(methods.get('doc.json')).toBe(8)
    expect(methods.get('note.txt')).toBe(0)

    const streamed = readZipStreaming(file, dir)
    if (streamed) {
      expect(streamed.error).toBeNull()
      expect(streamed.sizes.get('doc.json')).toBe(whole.length)
      expect(streamed.sizes.get('note.txt')).toBe(note.length)
    }
  })

  it('cannot be read front to back when an entry has a descriptor (documented)', async () => {
    const { zip } = build([{ name: 'a.bin', chunks: [Buffer.from('xyz')] }])
    const file = path.join(dir, 'descriptor.zip')
    await fs.writeFile(file, zip)
    const streamed = readZipStreaming(file, dir)
    if (streamed) expect(streamed.error).not.toBeNull()
  })
})

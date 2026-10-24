import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { crc32 } from 'zlib'

import { readZip, verifyZipWithTools } from './testing/readZip'
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
})

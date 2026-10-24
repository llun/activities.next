import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { crc32, inflateRawSync } from 'zlib'

import { MediaStorageType } from '@/lib/config/mediaStorage'

import { FileArchiveObjectStore } from './objectStore'
import {
  DEFLATE_END,
  PartStager,
  createInitialProgress,
  getPartKey,
  stagedCompressedSize
} from './progress'

describe('PartStager', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'part-stager-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('stages deflated parts that concatenate into one stream, and records sizes and CRC', async () => {
    const store = new FileArchiveObjectStore({
      type: MediaStorageType.LocalFile,
      path: root
    })
    const progress = createInitialProgress({ actors: [], now: 0 })
    const stage = new PartStager(store, 'id/secret', progress)
    await stage.append('doc.json', '{"a":[')
    await stage.appendJsonItems('doc.json', [1, 2, 3])
    await stage.appendJsonItems('doc.json', [4, 5])
    await stage.append('doc.json', ']}\n')

    const entry = progress.entries['doc.json']
    const text = '{"a":[1,2,3,4,5]}\n'
    expect(entry.parts).toBe(4)
    expect(entry.size).toBe(text.length)
    expect(entry.crc).toBe(crc32(Buffer.from(text)))

    const parts: Buffer[] = []
    for (let index = 0; index < entry.parts; index += 1) {
      const part = (await store.get(
        getPartKey('id/secret', 'doc.json', index)
      ))!
      expect(part.length).toBe(entry.sizes[index])
      parts.push(part)
    }
    const stream = Buffer.concat([...parts, DEFLATE_END])
    expect(stream.length).toBe(stagedCompressedSize(entry))
    expect(inflateRawSync(stream).toString()).toBe(text)
  })
})

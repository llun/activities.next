import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client as RealS3Client,
  type S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'

import {
  FileArchiveObjectStore,
  S3ArchiveObjectStore,
  assertArchiveKey,
  createArchiveObjectStore,
  getArchiveStorageKey
} from './objectStore'

const readAll = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

describe('assertArchiveKey', () => {
  it.each([
    'archives',
    'medias/a.jpg',
    'archives/../medias/a.jpg',
    'archives/a/../../b',
    'archives//a',
    '/archives/a',
    'archives/a b',
    'archives/a%2e%2e/b'
  ])('refuses %j', (key) => {
    expect(() => assertArchiveKey(key)).toThrow('Invalid archive storage key')
  })

  it('accepts keys under archives/', () => {
    expect(getArchiveStorageKey('abc-123', 'archive.zip')).toBe(
      'archives/abc-123/archive.zip'
    )
    expect(() => getArchiveStorageKey('../x')).toThrow()
  })
})

describe('FileArchiveObjectStore', () => {
  let root: string
  let store: FileArchiveObjectStore

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-store-'))
    store = new FileArchiveObjectStore({
      type: MediaStorageType.LocalFile,
      path: root
    })
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('stores, reads and deletes objects under archives/', async () => {
    await store.put('archives/a/stage/p-0', 'hello')
    expect((await store.get('archives/a/stage/p-0'))?.toString()).toBe('hello')
    expect(await store.size('archives/a/stage/p-0')).toBe(5)
    expect(await store.get('archives/a/missing')).toBeNull()
    expect(await store.openRead('archives/a/missing')).toBeNull()
    await store.delete('archives/a/stage/p-0')
    expect(await store.get('archives/a/stage/p-0')).toBeNull()
  })

  it('writes a resumable file through a partial and renames it when finished', async () => {
    const sink = await store.openResumableWrite('archives/a/archive.zip', null)
    await sink.write(Buffer.from('abc'))
    await expect(
      fs.stat(path.join(root, 'archives/a/archive.zip'))
    ).rejects.toThrow()
    await sink.write(Buffer.from('def'))
    expect(await sink.finish()).toBe(6)
    const stream = await store.openRead('archives/a/archive.zip')
    expect(await readAll(stream!)).toBe('abcdef')
  })

  it('resumes from a checkpoint and drops what was written after it', async () => {
    const first = await store.openResumableWrite('archives/a/archive.zip', null)
    await first.write(Buffer.from('abc'))
    const state = await first.checkpoint()
    await first.write(Buffer.from('LOST'))
    await first.release()

    const second = await store.openResumableWrite(
      'archives/a/archive.zip',
      state
    )
    await second.write(Buffer.from('def'))
    expect(await second.finish()).toBe(6)
    expect(
      await readAll((await store.openRead('archives/a/archive.zip'))!)
    ).toBe('abcdef')
  })

  it('removes a partial file together with the object', async () => {
    const sink = await store.openResumableWrite('archives/a/archive.zip', null)
    await sink.write(Buffer.from('abc'))
    await sink.release()
    await store.delete('archives/a/archive.zip')
    expect(await fs.readdir(path.join(root, 'archives/a'))).toEqual([])
  })

  it('abort throws the partial file away', async () => {
    const sink = await store.openResumableWrite('archives/a/archive.zip', null)
    await sink.write(Buffer.from('abc'))
    await sink.abort()
    expect(await fs.readdir(path.join(root, 'archives/a'))).toEqual([])
  })

  it('deletes a prefix but never the archives root', async () => {
    await store.put('archives/a/x', '1')
    await store.put('archives/b/x', '2')
    await store.deletePrefix('archives/a')
    expect(await store.get('archives/a/x')).toBeNull()
    expect((await store.get('archives/b/x'))?.toString()).toBe('2')
    await expect(store.deletePrefix('archives')).rejects.toThrow('whole')
    await expect(store.deletePrefix('archives/..')).rejects.toThrow()
    await expect(store.deletePrefix('medias')).rejects.toThrow()
  })

  it('has no direct download URL', async () => {
    expect(await store.getDownloadUrl()).toBeNull()
  })

  it('refuses a key outside archives/', async () => {
    await expect(store.put('medias/a.jpg', 'x')).rejects.toThrow()
    await expect(store.get('archives/../secret')).rejects.toThrow()
  })
})

describe('S3ArchiveObjectStore', () => {
  const objects = new Map<string, string>()
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key!, String(command.input.Body))
      return {}
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key!)
      if (body === undefined) {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      }
      return {
        Body: Object.assign(Readable.from([Buffer.from(body)]), {
          transformToByteArray: async () => Buffer.from(body)
        })
      }
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix!
      return {
        Contents: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key })),
        IsTruncated: false
      }
    }
    if (command instanceof DeleteObjectsCommand) {
      for (const { Key } of command.input.Delete!.Objects!) {
        objects.delete(Key!)
      }
      return {}
    }
    return {}
  })
  const store = new S3ArchiveObjectStore(
    {
      type: MediaStorageType.S3Storage,
      bucket: 'bucket',
      region: 'us-east-1'
    },
    { send } as unknown as S3Client
  )

  beforeEach(() => {
    objects.clear()
    send.mockClear()
  })

  it('puts and gets objects under archives/', async () => {
    await store.put('archives/a/stage/p-0', 'hello')
    expect((await store.get('archives/a/stage/p-0'))?.toString()).toBe('hello')
    expect(await store.get('archives/a/none')).toBeNull()
    const keys = send.mock.calls.map(
      ([command]) => (command as { input: { Key?: string } }).input.Key
    )
    expect(keys.every((key) => key?.startsWith('archives/'))).toBe(true)
  })

  it('deletes only the objects under one export', async () => {
    await store.put('archives/a/archive.zip', '1')
    await store.put('archives/ab/archive.zip', '2')
    await store.deletePrefix('archives/a')
    expect([...objects.keys()]).toEqual(['archives/ab/archive.zip'])
    await expect(store.deletePrefix('archives')).rejects.toThrow('whole')
  })

  it('creates the store that matches the media storage type', () => {
    expect(createArchiveObjectStore(undefined)).toBeNull()
    expect(
      createArchiveObjectStore({
        type: MediaStorageType.LocalFile,
        path: '/tmp/x'
      })
    ).toBeInstanceOf(FileArchiveObjectStore)
    expect(
      createArchiveObjectStore({
        type: MediaStorageType.S3Storage,
        bucket: 'b',
        region: 'r'
      })
    ).toBeInstanceOf(S3ArchiveObjectStore)
  })

  describe('resumable multipart writes', () => {
    const MIB = 1024 * 1024
    interface Upload {
      key: string
      parts: Map<number, Buffer>
    }
    const uploads = new Map<string, Upload>()
    const binary = new Map<string, Buffer>()
    const multipartSend = vi.fn(async (command: unknown) => {
      if (command instanceof CreateMultipartUploadCommand) {
        const id = `u${uploads.size + 1}`
        uploads.set(id, { key: command.input.Key!, parts: new Map() })
        return { UploadId: id }
      }
      if (command instanceof UploadPartCommand) {
        const upload = uploads.get(command.input.UploadId!)!
        const body = Buffer.from(command.input.Body as Buffer)
        // S3 refuses parts under 5 MiB except the last, which the test checks
        // at completion.
        upload.parts.set(command.input.PartNumber!, body)
        return { ETag: `"etag-${command.input.PartNumber}-${body.length}"` }
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        const upload = uploads.get(command.input.UploadId!)!
        const listed = command.input.MultipartUpload!.Parts!
        const bodies = listed.map((part) => {
          const body = upload.parts.get(part.PartNumber!)!
          expect(part.ETag).toBe(`"etag-${part.PartNumber}-${body.length}"`)
          return body
        })
        bodies.slice(0, -1).forEach((body) => {
          expect(body.length).toBeGreaterThanOrEqual(5 * MIB)
        })
        binary.set(upload.key, Buffer.concat(bodies))
        return {}
      }
      if (command instanceof PutObjectCommand) {
        binary.set(
          command.input.Key!,
          Buffer.from(command.input.Body as Buffer)
        )
        return {}
      }
      if (command instanceof GetObjectCommand) {
        const body = binary.get(command.input.Key!)
        if (!body) {
          throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
        }
        return {
          Body: { transformToByteArray: async () => new Uint8Array(body) }
        }
      }
      if (command instanceof DeleteObjectCommand) {
        binary.delete(command.input.Key!)
        return {}
      }
      return {}
    })
    const multipartStore = new S3ArchiveObjectStore(
      { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
      { send: multipartSend } as unknown as S3Client
    )

    beforeEach(() => {
      uploads.clear()
      binary.clear()
      multipartSend.mockClear()
    })

    it('uploads more than 5 MiB in parts across a checkpoint and reassembles it', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const data = Buffer.alloc(19 * MIB + 123, 7)
      data.writeUInt32BE(0xdeadbeef, 8 * MIB + 5)

      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(data.subarray(0, 11 * MIB + 17))
      const state = await first.checkpoint()
      expect(state).toMatchObject({
        uploaded: 8 * MIB,
        tailBytes: 3 * MIB + 17
      })
      await first.release()

      const second = await multipartStore.openResumableWrite(key, state)
      await second.write(data.subarray(11 * MIB + 17))
      expect(await second.finish()).toBe(data.length)

      expect(binary.get(key)?.equals(data)).toBe(true)
      // The staged tail is gone once the object is complete.
      expect(binary.has(`${key}.tail`)).toBe(false)
    })

    it('fails to resume when the staged tail is missing', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(Buffer.alloc(100))
      const state = await first.checkpoint()
      binary.delete(`${key}.tail`)
      await expect(
        multipartStore.openResumableWrite(key, state)
      ).rejects.toThrow('tail')
    })

    it('signs a download URL that lasts 5 minutes and names the file', async () => {
      const signing = new S3ArchiveObjectStore(
        {
          type: MediaStorageType.S3Storage,
          bucket: 'bucket',
          region: 'us-east-1'
        },
        new RealS3Client({
          region: 'us-east-1',
          credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' }
        })
      )
      const url = new URL(
        (await signing.getDownloadUrl('archives/a/t/archive-1.zip', {
          fileName: 'my export.zip'
        }))!
      )
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="my_export.zip"'
      )
      expect(url.searchParams.get('response-content-type')).toBe(
        'application/zip'
      )
    })
  })
})

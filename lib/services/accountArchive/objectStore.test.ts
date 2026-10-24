import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client
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

  it('writes through a temporary file and renames it when complete', async () => {
    const sink = store.openWrite('archives/a/archive.zip')
    sink.stream.write('abc')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(
      fs.stat(path.join(root, 'archives/a/archive.zip'))
    ).rejects.toThrow()
    sink.stream.end('def')
    expect(await sink.done).toBe(6)
    const stream = await store.openRead('archives/a/archive.zip')
    expect(await readAll(stream!)).toBe('abcdef')
  })

  it('removes a partial file together with the object', async () => {
    const sink = store.openWrite('archives/a/archive.zip')
    sink.stream.write('abc')
    sink.stream.destroy()
    await sink.done.catch(() => undefined)
    await store.delete('archives/a/archive.zip')
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
})

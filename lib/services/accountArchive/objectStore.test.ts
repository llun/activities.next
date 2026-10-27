import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client as RealS3Client,
  type S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import fs from 'fs/promises'
import http from 'http'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'

import {
  ARCHIVE_S3_REQUEST_TIMEOUT_MS,
  FileArchiveObjectStore,
  S3ArchiveObjectStore,
  assertArchiveKey,
  createArchiveObjectStore,
  getArchiveStorageKey
} from './objectStore'
import { ARCHIVE_LEASE_GRACE_MS } from './saver'

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

  it('accepts keys under imports/ as well', () => {
    expect(assertArchiveKey('imports/abc-123/archive.zip')).toBe(
      'imports/abc-123/archive.zip'
    )
    expect(() => assertArchiveKey('imports/../medias/a.jpg')).toThrow()
    expect(() => assertArchiveKey('importx/a')).toThrow()
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

  it('reads from a byte offset', async () => {
    await store.put('archives/a/archive.zip', 'ZIPDATA')
    expect(
      await readAll((await store.openRead('archives/a/archive.zip', 3))!)
    ).toBe('DATA')
  })

  it('reads an inclusive byte range', async () => {
    await store.put('archives/a/archive.zip', 'ZIPDATA')
    await store.put('imports/a/archive.zip', 'IMPORTDATA')
    expect(await store.readRange('archives/a/archive.zip', 0, 3)).toEqual(
      Buffer.from('ZIPD')
    )
    expect(await store.readRange('archives/a/archive.zip', 3, 6)).toEqual(
      Buffer.from('DATA')
    )
    expect(await store.readRange('imports/a/archive.zip', 0, 3)).toEqual(
      Buffer.from('IMPO')
    )
    expect(await store.readRange('archives/a/missing', 0, 3)).toBeNull()
  })

  it('offers no presigned upload URL on the file store', async () => {
    expect(
      await store.getUploadUrl('archives/a/archive.zip', 100, 60)
    ).toBeNull()
  })

  it('aborts an unfinished file from its state alone', async () => {
    const sink = await store.openResumableWrite('archives/a/archive.zip', null)
    await sink.write(Buffer.from('abc'))
    const state = await sink.checkpoint()
    await sink.release()
    await store.abortResumableWrite('archives/a/archive.zip', state)
    expect(await fs.readdir(path.join(root, 'archives/a'))).toEqual([])
  })

  it('does not cut what another worker wrote when a slow worker opens the file', async () => {
    const key = 'archives/a/archive.zip'
    const first = await store.openResumableWrite(key, null)
    await first.write(Buffer.from('0123456789'))
    const state = await first.checkpoint()
    await first.release()

    // The new owner resumes and writes on.
    const owner = await store.openResumableWrite(key, state)
    await owner.write(Buffer.from('ABCDEF'))
    // A worker that was slow to open the file resumes from the same state.
    const late = await store.openResumableWrite(key, state)
    await late.release()

    expect(await owner.finish()).toBe(16)
    expect(await fs.readFile(path.join(root, key))).toEqual(
      Buffer.from('0123456789ABCDEF')
    )
  })

  it('cuts leftovers of an unfinished slice when the file is finished', async () => {
    const key = 'archives/a/archive.zip'
    const first = await store.openResumableWrite(key, null)
    await first.write(Buffer.from('0123456789XXXX'))
    await first.release()
    const resumed = await store.openResumableWrite(key, { offset: 10 })
    await resumed.write(Buffer.from('AB'))
    expect(await resumed.finish()).toBe(12)
    expect(await fs.readFile(path.join(root, key))).toEqual(
      Buffer.from('0123456789AB')
    )
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
  const send = vi.fn(
    async (command: unknown): Promise<Record<string, unknown>> => {
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
    }
  )
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
    // ETags the store reports when they differ from the ones the upload gave.
    const etags = new Map<string, string>()
    let listHook: ((command: ListPartsCommand) => unknown) | null = null
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
      if (command instanceof ListPartsCommand) {
        if (listHook) return listHook(command)
        const upload = uploads.get(command.input.UploadId!)!
        return {
          Parts: [...upload.parts.entries()]
            .sort(([a], [b]) => a - b)
            .map(([PartNumber, body]) => ({
              PartNumber,
              Size: body.length,
              ETag:
                etags.get(`${command.input.UploadId}:${PartNumber}`) ??
                `"etag-${PartNumber}-${body.length}"`
            })),
          IsTruncated: false
        }
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        const upload = uploads.get(command.input.UploadId!)!
        const listed = command.input.MultipartUpload!.Parts!
        const bodies = listed.map((part) => {
          const body = upload.parts.get(part.PartNumber!)!
          expect(part.ETag).toBe(
            etags.get(`${command.input.UploadId}:${part.PartNumber}`) ??
              `"etag-${part.PartNumber}-${body.length}"`
          )
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
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [...binary.keys()]
            .filter((name) => name.startsWith(command.input.Prefix!))
            .map((Key) => ({ Key })),
          IsTruncated: false
        }
      }
      return {}
    })
    const multipartStore = new S3ArchiveObjectStore(
      { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
      { send: multipartSend } as unknown as S3Client
    )

    beforeEach(() => {
      uploads.clear()
      etags.clear()
      listHook = null
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
      expect(
        [...binary.keys()].filter((name) => name.includes('.tail-'))
      ).toEqual([])
    })

    it('completes with the ETags the store lists, not the ones in the cursor', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const small = new S3ArchiveObjectStore(
        { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
        { send: multipartSend } as unknown as S3Client,
        5 * MIB,
        1000,
        10
      )
      const data = crypto.randomBytes(11 * MIB)
      const sink = await small.openResumableWrite(key, null)
      await sink.write(data)
      // A stalled worker re-uploaded part 1 with the same bytes: the store now
      // holds another ETag for it than the one this worker recorded.
      const [id] = [...uploads.keys()]
      etags.set(`${id}:1`, '"late-etag-1"')
      expect(await sink.finish()).toBe(data.length)
      expect(binary.get(key)?.equals(data)).toBe(true)
    })

    it('completes with listed ETags that are 32 hex characters but not digests', async () => {
      const key = 'archives/a/t/archive-1.zip'
      // The ETag the cursor records is 32 hex characters too, so a plain-MD5
      // check of listed against recorded would see a mismatch here.
      const recordedSend = vi.fn(async (command: unknown) => {
        if (command instanceof UploadPartCommand) {
          await multipartSend(command)
          return { ETag: `"${'a'.repeat(32)}"` }
        }
        return multipartSend(command)
      })
      const data = crypto.randomBytes(11 * MIB)
      const sink = await new S3ArchiveObjectStore(
        { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
        { send: recordedSend } as unknown as S3Client,
        5 * MIB,
        1000,
        10
      ).openResumableWrite(key, null)
      await sink.write(data)
      // SSE-KMS: the store lists another 32-hex ETag for each part.
      const [id] = [...uploads.keys()]
      for (const partNumber of uploads.get(id)!.parts.keys()) {
        etags.set(`${id}:${partNumber}`, `"${'b'.repeat(32)}"`)
      }
      expect(await sink.finish()).toBe(data.length)
      expect(binary.get(key)?.equals(data)).toBe(true)
    })

    describe('listing the parts at the end', () => {
      const MIB = 1024 * 1024
      const small = () =>
        new S3ArchiveObjectStore(
          { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
          { send: multipartSend } as unknown as S3Client,
          5 * MIB,
          1000,
          10
        )
      const key = 'archives/a/t/archive-1.zip'
      const upload = async (bytes: number) => {
        const data = crypto.randomBytes(bytes)
        const sink = await small().openResumableWrite(key, null)
        await sink.write(data)
        return { sink, data }
      }
      const listing = (
        parts: { PartNumber: number; Size: number; ETag: string }[]
      ) => parts

      it('follows the pages of a long listing', async () => {
        const { sink, data } = await upload(11 * MIB)
        const [id] = [...uploads.keys()]
        const markers: (string | undefined)[] = []
        listHook = (command) => {
          markers.push(command.input.PartNumberMarker)
          const at = command.input.PartNumberMarker
            ? Number(command.input.PartNumberMarker)
            : 0
          const all = [...uploads.get(id)!.parts.entries()].map(
            ([PartNumber, body]) => ({
              PartNumber,
              Size: body.length,
              ETag: `"etag-${PartNumber}-${body.length}"`
            })
          )
          const page = all.filter((part) => part.PartNumber > at).slice(0, 1)
          return {
            Parts: listing(page),
            IsTruncated: page[0].PartNumber < all.length,
            NextPartNumberMarker: page[0].PartNumber
          }
        }
        expect(await sink.finish()).toBe(data.length)
        expect(markers.length).toBeGreaterThan(1)
        expect(binary.get(key)?.equals(data)).toBe(true)
      })

      it('refuses a part of the wrong size', async () => {
        const { sink } = await upload(11 * MIB)
        listHook = () => ({
          Parts: listing([
            { PartNumber: 1, Size: 5 * MIB - 1, ETag: '"x"' },
            { PartNumber: 2, Size: 5 * MIB, ETag: '"y"' },
            { PartNumber: 3, Size: MIB, ETag: '"z"' }
          ]),
          IsTruncated: false
        })
        await expect(sink.finish()).rejects.toThrow('wrong size')
      })

      it('stops when a provider repeats the page marker', async () => {
        const { sink } = await upload(11 * MIB)
        listHook = () => ({
          Parts: listing([{ PartNumber: 1, Size: 5 * MIB, ETag: '"x"' }]),
          IsTruncated: true,
          NextPartNumberMarker: 1
        })
        await expect(sink.finish()).rejects.toThrow('does not advance')
      })

      it('completes with the recorded ETags when the credentials may not list parts', async () => {
        const { sink, data } = await upload(11 * MIB)
        listHook = () => {
          throw Object.assign(new Error('denied'), {
            name: 'AccessDenied',
            $metadata: { httpStatusCode: 403 }
          })
        }
        expect(await sink.finish()).toBe(data.length)
        expect(binary.get(key)?.equals(data)).toBe(true)
      })

      it('still fails on a transient listing error', async () => {
        const { sink } = await upload(11 * MIB)
        listHook = () => {
          throw Object.assign(new Error('busy'), {
            name: 'ServiceUnavailable',
            $metadata: { httpStatusCode: 503 }
          })
        }
        await expect(sink.finish()).rejects.toThrow('busy')
      })

      it('completes with the recorded ETags when the store does not implement listing', async () => {
        const { sink, data } = await upload(11 * MIB)
        listHook = () => {
          throw Object.assign(new Error('nope'), {
            name: 'NotImplemented',
            $metadata: { httpStatusCode: 501 }
          })
        }
        expect(await sink.finish()).toBe(data.length)
        expect(binary.get(key)?.equals(data)).toBe(true)
      })
    })

    it('refuses to complete an upload that lacks a counted part', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const small = new S3ArchiveObjectStore(
        { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
        { send: multipartSend } as unknown as S3Client,
        5 * MIB,
        1000,
        10
      )
      const sink = await small.openResumableWrite(key, null)
      await sink.write(crypto.randomBytes(6 * MIB))
      const [upload] = [...uploads.values()]
      upload.parts.delete(1)
      await expect(sink.finish()).rejects.toThrow('expected parts')
    })

    it('fails to resume when the staged tail is missing', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(Buffer.alloc(100))
      const state = await first.checkpoint()
      binary.delete(String((state as { tail: string }).tail))
      await expect(
        multipartStore.openResumableWrite(key, state)
      ).rejects.toThrow('tail')
    })

    it('keeps the saved tail when a later checkpoint never lands', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const data = crypto.randomBytes(40 * MIB)
      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(data.subarray(0, 3 * MIB))
      const saved = await first.checkpoint()
      await first.committed()

      // A later checkpoint writes its tail but the cursor save is lost (the
      // worker was killed, or lost its lease and a stalled call went through).
      // Eight more MiB leaves a tail of the same length as the saved one.
      await first.write(data.subarray(3 * MIB, 11 * MIB))
      await first.checkpoint()

      const second = await multipartStore.openResumableWrite(key, saved)
      await second.write(data.subarray(3 * MIB))
      expect(await second.finish()).toBe(data.length)
      expect(binary.get(key)?.equals(data)).toBe(true)
    })

    it('still resumes from the saved state when the lost checkpoint had a different tail length', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const data = crypto.randomBytes(5 * MIB)
      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(data.subarray(0, 3 * MIB))
      const saved = await first.checkpoint()
      await first.committed()
      await first.write(data.subarray(3 * MIB, 4 * MIB))
      await first.checkpoint()

      const second = await multipartStore.openResumableWrite(key, saved)
      await second.write(data.subarray(3 * MIB))
      await second.finish()
      expect(binary.get(key)?.equals(data)).toBe(true)
    })

    it('drops the old tail only after the new state is committed', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const sink = await multipartStore.openResumableWrite(key, null)
      await sink.write(Buffer.alloc(1000, 1))
      const one = (await sink.checkpoint()) as { tail: string }
      await sink.committed()
      await sink.write(Buffer.alloc(1000, 2))
      const two = (await sink.checkpoint()) as { tail: string }
      expect(two.tail).not.toBe(one.tail)
      expect(binary.has(one.tail)).toBe(true)
      expect(binary.has(two.tail)).toBe(true)
      await sink.committed()
      expect(binary.has(one.tail)).toBe(false)
      expect(binary.has(two.tail)).toBe(true)
    })

    it('aborts the upload and removes the tails without reading any of them', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const first = await multipartStore.openResumableWrite(key, null)
      await first.write(Buffer.alloc(100))
      const state = await first.checkpoint()
      // The tail is gone (the reason an assembly gave up), so a resume fails,
      // but throwing the upload away needs only the saved state.
      const tail = String((state as { tail: string }).tail)
      binary.set(`${tail}-other`, Buffer.from('x'))
      binary.delete(tail)
      multipartSend.mockClear()

      await multipartStore.abortResumableWrite(key, state)

      const sent = multipartSend.mock.calls.map(([command]) => command)
      expect(sent.some((c) => c instanceof GetObjectCommand)).toBe(false)
      expect(
        sent.find((c) => c instanceof AbortMultipartUploadCommand)
      ).toMatchObject({
        input: { UploadId: (state as { uploadId: string }).uploadId, Key: key }
      })
      expect(
        [...binary.keys()].filter((name) => name.includes('.tail-'))
      ).toEqual([])
    })

    it('grows the part size with the part count and fails clearly before the part limit', async () => {
      const key = 'archives/a/t/archive-1.zip'
      // Parts of 4 bytes, 8 after two parts, 12 after four; at most five.
      const small = new S3ArchiveObjectStore(
        { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
        { send: multipartSend } as unknown as S3Client,
        4,
        2,
        5
      )
      const sink = await small.openResumableWrite(key, null)
      await sink.write(Buffer.alloc(4 + 4 + 8 + 8 + 12, 1))
      const [upload] = [...uploads.values()]
      expect([...upload.parts.values()].map((part) => part.length)).toEqual([
        4, 4, 8, 8, 12
      ])
      // A sixth part would be the limit plus one.
      await expect(sink.write(Buffer.alloc(12, 1))).rejects.toThrow(
        'too large to upload'
      )
    })

    it('reads from a byte offset with a range request', async () => {
      const key = 'archives/a/t/archive-1.zip'
      objects.set(key, 'ZIPDATA')
      send.mockClear()
      await store.openRead(key, 3)
      const ranged = send.mock.calls[0][0] as GetObjectCommand
      expect(ranged.input.Range).toBe('bytes=3-')
      send.mockClear()
      await store.openRead(key)
      expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe(
        undefined
      )
    })

    it('rejects a request that gets no answer in time instead of waiting for it', async () => {
      // A server that answers only after the client has given up.
      let requests = 0
      const server = http.createServer((_req, res) => {
        requests += 1
        setTimeout(() => {
          res.statusCode = 200
          res.end()
        }, 1500).unref()
      })
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      try {
        // CI has no AWS credentials; stub static ones so the default provider
        // chain does not fail before the request can time out.
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'test')
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test')
        const client = createStorageS3Client({
          region: 'us-east-1',
          endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          requestTimeoutMs: 200
        })
        const started = Date.now()
        await expect(
          client.send(new HeadObjectCommand({ Bucket: 'b', Key: 'k' }))
        ).rejects.toMatchObject({ name: 'TimeoutError' })
        // One attempt: the SDK would retry a timeout twice, which makes the
        // call as long as three timeouts and longer than the lease.
        expect(Date.now() - started).toBeLessThan(200 * 1.9)
        expect(requests).toBe(1)
        client.destroy()
      } finally {
        vi.unstubAllEnvs()
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    })

    it('joins many small chunks into the same parts and tail', async () => {
      const key = 'archives/a/t/archive-1.zip'
      const small = new S3ArchiveObjectStore(
        { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'r' },
        { send: multipartSend } as unknown as S3Client,
        5 * MIB,
        1000,
        10
      )
      const data = crypto.randomBytes(12 * MIB + 5)
      const sink = await small.openResumableWrite(key, null)
      for (let at = 0; at < data.length; at += 16 * 1024) {
        await sink.write(data.subarray(at, at + 16 * 1024))
      }
      const state = await sink.checkpoint()
      expect(state).toMatchObject({
        uploaded: 10 * MIB,
        tailBytes: 2 * MIB + 5
      })
      expect(await sink.finish()).toBe(data.length)
      expect(binary.get(key)?.equals(data)).toBe(true)
    })

    it('gives every S3 call a timeout shorter than the lease grace', async () => {
      expect(ARCHIVE_S3_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(
        ARCHIVE_LEASE_GRACE_MS / 2
      )
      const client = createStorageS3Client({
        region: 'us-east-1',
        requestTimeoutMs: ARCHIVE_S3_REQUEST_TIMEOUT_MS
      })
      const handler = client.config.requestHandler as unknown as {
        configProvider: Promise<{ requestTimeout?: number }>
      }
      expect((await handler.configProvider).requestTimeout).toBe(
        ARCHIVE_S3_REQUEST_TIMEOUT_MS
      )
    })

    it('hands out no download link when the bucket has a public hostname', async () => {
      const publicStore = new S3ArchiveObjectStore(
        {
          type: MediaStorageType.S3Storage,
          bucket: 'bucket',
          region: 'us-east-1',
          hostname: 'media.example.com'
        },
        new RealS3Client({
          region: 'us-east-1',
          credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' }
        })
      )
      expect(
        await publicStore.getDownloadUrl('archives/a/t/archive-1.zip', {
          fileName: 'x.zip'
        })
      ).toBeNull()
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

describe('S3 range reads and presigned upload URLs', () => {
  const objects = new Map<string, string>([
    ['archives/a/t/archive-1.zip', 'ZIPDATA'],
    ['imports/a/t/archive-1.zip', 'IMPORTDATA']
  ])
  const defaultSend = async (
    command: unknown
  ): Promise<Record<string, unknown>> => {
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key!)
      if (body === undefined) {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      }
      // The real SDK honours Range server-side; the caller sees the slice.
      const range = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range ?? '')
      const sliced = range
        ? body.slice(Number(range[1]), Number(range[2]) + 1)
        : body
      return {
        Body: {
          transformToByteArray: async () => Buffer.from(sliced)
        }
      }
    }
    if (command instanceof PutObjectCommand) {
      objects.set(command.input.Key!, String(command.input.Body))
      return {}
    }
    return {}
  }
  const send = vi.fn(defaultSend)
  const store = new S3ArchiveObjectStore(
    { type: MediaStorageType.S3Storage, bucket: 'bucket', region: 'us-east-1' },
    { send } as unknown as S3Client
  )

  it('reads a byte range with an S3 GetObject', async () => {
    send.mockClear()
    expect(await store.readRange('archives/a/t/archive-1.zip', 0, 3)).toEqual(
      Buffer.from('ZIPD')
    )
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe(
      'bytes=0-3'
    )
  })

  it('returns size and ETag from an S3 HEAD request', async () => {
    send.mockClear()
    send.mockImplementationOnce(async () => ({
      ContentLength: 10,
      ETag: '"version-1"'
    }))
    expect(await store.getMetadata('imports/a/t/archive-1.zip')).toEqual({
      size: 10,
      etag: '"version-1"'
    })
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
  })

  it('reads a byte range from the import root too', async () => {
    expect(await store.readRange('imports/a/t/archive-1.zip', 6, 10)).toEqual(
      Buffer.from('DATA')
    )
  })

  it('pins range reads to the expected ETag and object size', async () => {
    send.mockReset().mockImplementation(defaultSend)
    send.mockImplementationOnce(async () => ({
      ContentRange: 'bytes 0-3/10',
      Body: { transformToByteArray: async () => Buffer.from('ZIPD') }
    }))
    expect(
      await store.readRange('imports/a/t/archive-1.zip', 0, 3, {
        ifMatch: '"version-1"',
        expectedSize: 10
      })
    ).toEqual(Buffer.from('ZIPD'))
    expect((send.mock.calls[0][0] as GetObjectCommand).input.IfMatch).toBe(
      '"version-1"'
    )

    send.mockImplementationOnce(async () => ({
      ContentRange: 'bytes 0-3/11',
      Body: { transformToByteArray: async () => Buffer.from('ZIPD') }
    }))
    await expect(
      store.readRange('imports/a/t/archive-1.zip', 0, 3, {
        ifMatch: '"version-1"',
        expectedSize: 10
      })
    ).rejects.toMatchObject({ name: 'PreconditionFailed' })
  })

  it('presigns a direct upload with its exact content length', async () => {
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T00:00:00.000Z'))
    try {
      const url = await signing.getUploadUrl(
        'archives/a/t/upload.zip',
        100,
        15 * 60
      )
      const differentSizeUrl = await signing.getUploadUrl(
        'archives/a/t/upload.zip',
        101,
        15 * 60
      )
      const signedUrl = new URL(url!)
      expect(signedUrl.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(signedUrl.searchParams.get('X-Amz-Signature')).toBeTruthy()
      expect(signedUrl.searchParams.get('X-Amz-SignedHeaders')).toContain(
        'content-length'
      )
      expect(signedUrl.searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(differentSizeUrl!).searchParams.get('X-Amz-Signature')
      )
      expect(
        await signing.getUploadUrl(
          'archives/a/t/at-limit.zip',
          5 * 1024 * 1024 * 1024,
          60
        )
      ).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not presign a single PUT whose configured cap exceeds five GiB', async () => {
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
    const url = await signing.getUploadUrl(
      'archives/a/t/upload.zip',
      5 * 1024 * 1024 * 1024 + 1,
      60
    )
    expect(url).toBeNull()
  })

  it('refuses a presigned upload URL for a key outside the archive roots', async () => {
    await expect(store.getUploadUrl('medias/a.jpg', 100, 60)).rejects.toThrow()
  })
})

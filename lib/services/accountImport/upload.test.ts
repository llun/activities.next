import type { Database } from '@/lib/database/types'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { uploadAccountImport } from '@/lib/services/accountImport/upload'
import type { AccountImport } from '@/lib/types/domain/accountImport'

const accountImport = (status: AccountImport['status']): AccountImport => ({
  id: 'import-late-upload',
  accountId: 'account-id',
  actorId: 'https://llun.test/users/current',
  status,
  kind: null,
  archiveETag: null,
  options: '{}',
  storageToken: 'token',
  uploadedBytes: 0,
  progress: null,
  phase: null,
  cursor: null,
  runToken: null,
  claimedUntil: null,
  lastErrorCode: null,
  createdAt: 0,
  startedAt: null,
  finishedAt: null,
  updatedAt: 0
})

describe('uploadAccountImport', () => {
  const makeSink = () => {
    const calls: string[] = []
    return {
      calls,
      sink: {
        write: async () => {
          calls.push('write')
        },
        checkpoint: async () => ({}),
        committed: async () => {},
        release: async () => {},
        finish: async () => {
          calls.push('finish')
          return 0
        },
        abort: async () => {
          calls.push('abort')
        }
      }
    }
  }

  const makeObjectStore = (
    sink: ReturnType<typeof makeSink>['sink'],
    onDeleted: () => void = () => {}
  ) =>
    ({
      store: {
        openResumableWrite: async () => sink
      },
      getUploadKey: () => 'imports/import-late-upload/token/upload.zip',
      deleteUpload: async () => onDeleted()
    }) as unknown as AccountImportObjectStore

  it('refuses a late upload whose row left queued before the bytes are stored', async () => {
    // The row reads as running by the time the streamed body is fully
    // staged, the way a start that raced this upload would leave it.
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi
        .fn()
        .mockResolvedValue({ ...row, status: 'running' }),
      updateAccountImport: vi.fn().mockResolvedValue(false)
    } as unknown as Database
    const { sink, calls } = makeSink()
    let deleted = false
    const objectStore = makeObjectStore(sink, () => {
      deleted = true
    })

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(8))
          controller.close()
        }
      }),
      now: () => 0
    })

    // The upload is refused, the staged bytes are thrown away, and the
    // running import's archive key is never written to (and never deleted).
    expect(result).toEqual({ type: 'not-queued' })
    expect(calls).toContain('abort')
    expect(calls).not.toContain('finish')
    expect(deleted).toBe(false)
  })

  it('stores an upload whose row is still queued when the bytes land', async () => {
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi.fn().mockResolvedValue(row),
      updateAccountImport: vi.fn().mockResolvedValue(true)
    } as unknown as Database
    const { sink, calls } = makeSink()
    const objectStore = makeObjectStore(sink)

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(8))
          controller.close()
        }
      }),
      now: () => 0
    })

    expect(result).toEqual({ type: 'stored', bytes: 8 })
    expect(calls).toContain('finish')
    expect(calls).not.toContain('abort')
  })

  it('deletes the stored object when the row is cancelled between the write and the update', async () => {
    // The row reads as queued right before the bytes are stored, but the
    // conditional update matches nothing: a cancel landed in between and
    // its cleanup may already have run, so the object this upload just
    // wrote must not be left behind.
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi
        .fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: 'cancelled' }),
      updateAccountImport: vi.fn().mockResolvedValue(false)
    } as unknown as Database
    const { sink, calls } = makeSink()
    let deleted = false
    const objectStore = makeObjectStore(sink, () => {
      deleted = true
    })

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(8))
          controller.close()
        }
      }),
      now: () => 0
    })

    expect(result).toEqual({ type: 'not-queued' })
    expect(calls).toContain('finish')
    expect(deleted).toBe(true)
  })

  it('keeps the stored object when the row started between the write and the update', async () => {
    // A row that started meanwhile owns the key: its start accepted this
    // very object, so the late upload's cleanup must not delete the
    // running import's archive.
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi
        .fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, status: 'running' }),
      updateAccountImport: vi.fn().mockResolvedValue(false)
    } as unknown as Database
    const { sink, calls } = makeSink()
    let deleted = false
    const objectStore = makeObjectStore(sink, () => {
      deleted = true
    })

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(8))
          controller.close()
        }
      }),
      now: () => 0
    })

    expect(result).toEqual({ type: 'not-queued' })
    expect(calls).toContain('finish')
    expect(deleted).toBe(false)
  })

  it('keeps the archive when a failed upload no longer owns its row', async () => {
    // failUpload must not delete the staged archive of a row that already
    // left queued: its conditional update matches nothing.
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi.fn().mockResolvedValue(row),
      updateAccountImport: vi.fn().mockResolvedValue(false)
    } as unknown as Database
    let deleted = false
    const objectStore = makeObjectStore(makeSink().sink, () => {
      deleted = true
    })

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: null,
      now: () => 0
    })

    expect(result).toEqual({ type: 'invalid' })
    expect(deleted).toBe(false)
  })

  it('deletes the staged upload of a queued row it fails', async () => {
    const row = accountImport('queued')
    const database = {
      getAccountImport: vi.fn().mockResolvedValue(row),
      updateAccountImport: vi.fn().mockResolvedValue(true)
    } as unknown as Database
    let deleted = false
    const objectStore = makeObjectStore(makeSink().sink, () => {
      deleted = true
    })

    const result = await uploadAccountImport({
      database,
      objectStore,
      accountImport: row,
      body: null,
      now: () => 0
    })

    expect(result).toEqual({ type: 'invalid' })
    expect(deleted).toBe(true)
  })
})

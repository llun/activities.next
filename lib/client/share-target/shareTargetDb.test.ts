/** @vitest-size medium */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  peekStagedShare,
  stageShareFiles,
  takeStagedShare,
  toShareFiles
} from './shareTargetDb'
import { SHARE_TARGET_DB_NAME, SHARE_TARGET_TTL_MS } from './types'

const file = (name: string, type: string, bytes: number[] = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type })

const writeRaw = async (record: any) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SHARE_TARGET_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('shares', 'readwrite')
      tx.objectStore('shares').put(record)
      tx.oncomplete = () => resolve(undefined)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

describe('shareTargetDb', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stages files as ArrayBuffers and rebuilds them', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')], {
      title: 'Hi'
    })

    expect(id).toBeTruthy()
    const share = await peekStagedShare(id!)
    expect(share).not.toBeNull()
    expect(share!.title).toBe('Hi')
    expect(share!.files[0].bytes).toBeInstanceOf(ArrayBuffer)

    const files = toShareFiles(share!)
    expect(files[0].name).toBe('photo.jpg')
    expect(files[0].type).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await files[0].arrayBuffer()))).toEqual([
      1, 2, 3
    ])
  })

  it('consumes a share exactly once', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])

    const first = await takeStagedShare(id!)
    expect(first).not.toBeNull()

    expect(await takeStagedShare(id!)).toBeNull()
    expect(await peekStagedShare(id!)).toBeNull()
  })

  it('peek does not consume', async () => {
    const id = await stageShareFiles([file('photo.jpg', 'image/jpeg')])

    expect(await peekStagedShare(id!)).not.toBeNull()
    expect(await peekStagedShare(id!)).not.toBeNull()
  })

  it('ignores a share past its 24 hour life', async () => {
    await writeRaw({
      id: 'stale',
      createdAt: Date.now() - SHARE_TARGET_TTL_MS - 1000,
      files: []
    })

    expect(await peekStagedShare('stale')).toBeNull()
    expect(await takeStagedShare('stale')).toBeNull()
  })

  it('returns null when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)

    expect(await peekStagedShare('anything')).toBeNull()
    expect(await takeStagedShare('anything')).toBeNull()
    expect(await stageShareFiles([file('a.jpg', 'image/jpeg')])).toBeNull()
  })
})

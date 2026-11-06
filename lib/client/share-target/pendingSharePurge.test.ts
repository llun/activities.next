/**
 * @vitest-environment jsdom
 * @vitest-size medium
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markSharePurgePending,
  readSharePurgePending,
  settleSharePurge
} from './pendingSharePurge'
import {
  honourPendingSharePurge,
  peekStagedShare,
  stageShareFiles
} from './shareTargetDb'

const file = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

// An IndexedDB whose every open fails, as a broken store does.
const brokenIndexedDB = {
  open: () => {
    const request: { onerror?: () => void; error: Error } = {
      error: new Error('broken')
    }
    setTimeout(() => request.onerror?.(), 0)
    return request
  }
}

describe('pending share purge', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('reads every share when no purge is pending', async () => {
    const id = await stageShareFiles([file('a.jpg')])

    expect(await honourPendingSharePurge()).toBe(true)
    expect(await peekStagedShare(id!)).not.toBeNull()
  })

  // A sign-out whose clear failed: the next reader purges the previous
  // account's shares before reading anything, and keeps any made since.
  it('purges the shares staged up to the sign-out, keeps later ones, and settles', async () => {
    const before = await stageShareFiles([file('old.jpg')])
    const markedAt = Date.now()
    await markSharePurgePending(markedAt)
    vi.spyOn(Date, 'now').mockReturnValue(markedAt + 1000)
    const after = await stageShareFiles([file('new.jpg')])
    vi.mocked(Date.now).mockRestore()

    expect(await honourPendingSharePurge()).toBe(true)

    expect(await peekStagedShare(before!)).toBeNull()
    expect(await peekStagedShare(after!)).not.toBeNull()
    expect(await readSharePurgePending()).toBeNull()
  })

  it('keeps the marker, and allows no read, while the purge still fails', async () => {
    await markSharePurgePending(Date.now())
    vi.stubGlobal('indexedDB', brokenIndexedDB)

    expect(await honourPendingSharePurge()).toBe(false)
    expect(await readSharePurgePending()).not.toBeNull()
  })

  it('removes the marker once settled', async () => {
    await markSharePurgePending(1234)
    expect(await readSharePurgePending()).toBe(1234)

    await settleSharePurge()

    expect(await readSharePurgePending()).toBeNull()
  })
})

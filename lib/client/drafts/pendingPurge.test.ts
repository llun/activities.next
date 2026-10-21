/**
 * @vitest-environment jsdom
 */
import { IDBFactory } from 'fake-indexeddb'

import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { resetDraftsChannelForTesting } from './draftsChannel'
import {
  countDrafts,
  getAccountEpoch,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from './draftsDb'
import { purgeAccountDrafts, runPendingPurges } from './pendingPurge'
import type { DraftRecord } from './types'

const KEY = 'activities-drafts-pending-purge'

const draft = (id: string, accountId = 'account-1'): DraftRecord => ({
  id,
  accountId,
  actorId: 'actor-1',
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'hello',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: []
})

const pending = () => JSON.parse(window.localStorage.getItem(KEY) ?? '[]')

describe('pending purge', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    window.localStorage.clear()
  })

  afterEach(() => {
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('purgeAccountDrafts deletes the drafts and leaves nothing pending', async () => {
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await purgeAccountDrafts('account-1')

    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
    expect(await getAccountEpoch('account-1')).toBe(1)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('a failed deletion stays pending and never throws', async () => {
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()

    await expect(purgeAccountDrafts('account-1')).resolves.toBeUndefined()
    expect(pending()).toEqual(['account-1'])

    // Still unavailable: it stays pending, and is not recorded twice.
    await runPendingPurges()
    await purgeAccountDrafts('account-1')
    expect(pending()).toEqual(['account-1'])
  })

  it('runPendingPurges deletes only the pending account, once storage is back', async () => {
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
    await saveDraft(draft('other', 'account-2'), {
      expectedRevision: 0,
      epoch: 0
    })
    window.localStorage.setItem(KEY, JSON.stringify(['account-1']))

    await runPendingPurges()

    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
    expect(await countDrafts({ accountId: 'account-2' })).toBe(1)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('a second call while one is running joins it: one purge, one epoch bump', async () => {
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
    window.localStorage.setItem(KEY, JSON.stringify(['account-1']))

    await Promise.all([runPendingPurges(), runPendingPurges()])

    expect(await getAccountEpoch('account-1')).toBe(1)
    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
  })

  it('does nothing, and does not open storage, when nothing is pending', async () => {
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()

    await expect(runPendingPurges()).resolves.toBeUndefined()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('survives unreadable or unwritable localStorage', async () => {
    window.localStorage.setItem(KEY, '{not json')
    await expect(runPendingPurges()).resolves.toBeUndefined()

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      }
    })
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await expect(purgeAccountDrafts('account-1')).resolves.toBeUndefined()
    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
  })
})

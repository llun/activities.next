import { IDBFactory } from 'fake-indexeddb'

import {
  ATTEMPTED_UNQUEUE_MESSAGE,
  DraftBusyError,
  DraftConflictError,
  claimQueuedDraft,
  deleteAccountDrafts,
  getDraft,
  pauseQueue,
  renewClaim,
  resetDraftsDbForTesting,
  resumeQueue,
  saveDraft,
  setDraftsIndexedDBFactory,
  unqueueDraft,
  updateQueuedDraft
} from './draftsDb'
import type { DraftQueueState, DraftRecord } from './types'

const NOW = 1_000_000

const queued = (
  id: string,
  queue: Partial<DraftQueueState> = {},
  patch: Partial<DraftRecord> = {}
): DraftRecord => ({
  id,
  accountId: 'account-1',
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
  attachments: [],
  queue: { state: 'waiting', queuedAt: 10, attempts: 0, ...queue },
  ...patch
})

const store = async (record: DraftRecord) =>
  saveDraft(record, { expectedRevision: 0, epoch: 0 })

const claim = (id: string, tabId = 'tab-a', now = NOW, epoch = 0) =>
  claimQueuedDraft(id, {
    tabId,
    now,
    leaseMs: 90_000,
    accountId: 'account-1',
    epoch
  })

describe('draftsDb send queue', () => {
  beforeEach(() => {
    setDraftsIndexedDBFactory(new IDBFactory())
  })

  afterEach(() => {
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
  })

  describe('claimQueuedDraft', () => {
    it('lets exactly one of two concurrent claims win', async () => {
      await store(queued('a'))
      const results = await Promise.all([
        claim('a', 'tab-a'),
        claim('a', 'tab-b')
      ])
      const winners = results.filter((result) => result !== null)
      expect(winners).toHaveLength(1)
      const stored = await getDraft('a')
      expect(stored?.queue?.claim?.tabId).toBe(winners[0]?.queue?.claim?.tabId)
      expect(stored?.revision).toBe(2)
    })

    it('writes sending, the lease, a new revision, and keeps updatedAt', async () => {
      const saved = await store(
        queued('a', { state: 'paused', pausedBy: 'rate_limit', reason: 'x' })
      )
      const claimed = await claim('a')
      expect(claimed).toMatchObject({
        revision: saved.revision + 1,
        updatedAt: saved.updatedAt,
        queue: {
          state: 'sending',
          claim: { tabId: 'tab-a', until: NOW + 90_000 }
        }
      })
      expect(claimed?.queue).not.toHaveProperty('pausedBy')
      expect(claimed?.queue).not.toHaveProperty('reason')
    })

    it('reclaims an expired lease and refuses a live one', async () => {
      await store(
        queued('a', { state: 'sending', claim: { tabId: 'dead', until: NOW } })
      )
      await store(
        queued('b', {
          state: 'sending',
          claim: { tabId: 'live', until: NOW + 1 }
        })
      )
      expect((await claim('a'))?.queue?.claim?.tabId).toBe('tab-a')
      expect(await claim('b')).toBeNull()
      expect((await getDraft('b'))?.queue?.claim?.tabId).toBe('live')
    })

    it('returns null on an epoch mismatch', async () => {
      await store(queued('a'))
      expect(await claim('a', 'tab-a', NOW, 1)).toBeNull()
      expect((await getDraft('a'))?.queue?.state).toBe('waiting')
    })

    it('returns null for another account’s draft and leaves it unchanged', async () => {
      await store(queued('b', {}, { accountId: 'account-2' }))
      expect(await claim('b')).toBeNull()
      expect(await getDraft('b')).toMatchObject({
        revision: 1,
        queue: { state: 'waiting' }
      })
    })

    it('returns null until nextAttemptAt is due', async () => {
      await store(queued('a', { state: 'checking', nextAttemptAt: NOW + 1 }))
      expect(await claim('a', 'tab-a', NOW)).toBeNull()
      expect((await claim('a', 'tab-a', NOW + 1))?.queue?.state).toBe('sending')
    })

    it('claims paused(rate_limit) once due, never other pauses', async () => {
      await store(
        queued('a', {
          state: 'paused',
          pausedBy: 'rate_limit',
          nextAttemptAt: NOW + 5
        })
      )
      expect(await claim('a', 'tab-a', NOW)).toBeNull()
      expect(await claim('a', 'tab-a', NOW + 5)).not.toBeNull()
    })

    it.each(['user', 'auth', 'actor'] as const)(
      'never claims paused(%s), even once nextAttemptAt is past',
      async (pausedBy) => {
        await store(
          queued('b', { state: 'paused', pausedBy, nextAttemptAt: NOW - 1 })
        )
        expect(await claim('b', 'tab-a', NOW + 5)).toBeNull()
      }
    )

    it('never claims a plain draft or a terminal state', async () => {
      await store({ ...queued('a'), queue: undefined })
      await store(queued('b', { state: 'needs_review' }))
      await store(queued('c', { state: 'couldnt_send' }))
      expect(await claim('a')).toBeNull()
      expect(await claim('b')).toBeNull()
      expect(await claim('c')).toBeNull()
    })
  })

  describe('updateQueuedDraft', () => {
    it('rejects a stale revision and leaves the record unchanged', async () => {
      const saved = await store(queued('a'))
      await expect(
        updateQueuedDraft('a', saved.revision + 1, (r) => ({ ...r, text: 'x' }))
      ).rejects.toBeInstanceOf(DraftConflictError)
      expect(await getDraft('a')).toEqual(saved)
    })

    it('rejects a missing draft instead of creating it', async () => {
      await expect(
        updateQueuedDraft('gone', 0, (r) => r)
      ).rejects.toBeInstanceOf(DraftConflictError)
      expect(await getDraft('gone')).toBeUndefined()
    })

    it('bumps the revision and keeps updatedAt', async () => {
      const saved = await store(queued('a'))
      const updated = await updateQueuedDraft('a', saved.revision, (r) => ({
        ...r,
        submit: { key: 'k', fingerprint: 'f' },
        updatedAt: 999_999
      }))
      expect(updated).toMatchObject({
        revision: saved.revision + 1,
        updatedAt: saved.updatedAt,
        submit: { key: 'k', fingerprint: 'f' }
      })
      expect(await getDraft('a')).toEqual(updated)
    })
  })

  describe('renewClaim', () => {
    it('extends only the owning tab, without a revision bump', async () => {
      await store(queued('a'))
      const claimed = await claim('a', 'tab-a')
      expect(await renewClaim('a', { tabId: 'tab-b', until: NOW * 2 })).toBe(
        false
      )
      expect(await renewClaim('a', { tabId: 'tab-a', until: NOW * 2 })).toBe(
        true
      )
      const stored = await getDraft('a')
      expect(stored?.queue?.claim).toEqual({ tabId: 'tab-a', until: NOW * 2 })
      expect(stored?.revision).toBe(claimed?.revision)
    })

    it('is false once the item is no longer sending', async () => {
      await store(queued('a'))
      expect(await renewClaim('a', { tabId: 'tab-a', until: NOW })).toBe(false)
    })
  })

  describe('unqueueDraft', () => {
    it.each([
      [
        'a live sending claim',
        { state: 'sending', claim: { tabId: 't', until: NOW + 1 } }
      ],
      [
        'an expired sending claim',
        { state: 'sending', claim: { tabId: 't', until: 0 } }
      ],
      ['checking', { state: 'checking', firstAttemptAt: 5 }]
    ] as const)('refuses %s with DraftBusyError', async (_name, queue) => {
      const saved = await store(queued('a', queue))
      await expect(unqueueDraft('a')).rejects.toBeInstanceOf(DraftBusyError)
      expect(await getDraft('a')).toEqual(saved)
    })

    it.each(['waiting', 'paused', 'needs_review', 'couldnt_send'] as const)(
      'unqueues %s and keeps submit, attemptedAt and lockedMessage',
      async (state) => {
        const saved = await store(
          queued(
            'a',
            { state, firstAttemptAt: 7 },
            {
              submit: { key: 'k', fingerprint: 'f' },
              attemptedAt: 7,
              lockedMessage: 'locked'
            }
          )
        )
        const returned = await unqueueDraft('a')
        expect(returned).not.toHaveProperty('queue')
        expect(returned).toMatchObject({
          revision: saved.revision + 1,
          updatedAt: saved.updatedAt,
          submit: { key: 'k', fingerprint: 'f' },
          attemptedAt: 7,
          lockedMessage: 'locked'
        })
        expect(await getDraft('a')).toEqual(returned)
      }
    )

    describe('an attempted draft without a lock', () => {
      const attachments = [
        {
          localId: 'l',
          mediaId: 'm',
          owned: true,
          mediaType: 'image/png',
          fileName: 'a.png',
          description: '',
          decorative: false,
          hasBlob: true
        }
      ]
      const fitnessFile = {
        localId: 'f',
        fitnessFileId: 'fit',
        owned: true,
        fileName: 'a.fit',
        mimeType: 'application/octet-stream',
        size: 1,
        hasBlob: true
      }

      it.each([
        [
          'firstAttemptAt',
          { state: 'couldnt_send', firstAttemptAt: 7 },
          {} as Partial<DraftRecord>
        ],
        [
          'attemptedAt with submit',
          { state: 'paused', pausedBy: 'user' },
          { attemptedAt: 7, submit: { key: 'k', fingerprint: 'f' } }
        ]
      ] as const)(
        'is locked, with its media not owned, on %s',
        async (_name, queue, patch) => {
          await store(
            queued('a', queue, {
              ...patch,
              attachments,
              fitnessFile
            } as Partial<DraftRecord>)
          )
          const returned = await unqueueDraft('a')
          expect(returned?.lockedMessage).toBe(ATTEMPTED_UNQUEUE_MESSAGE)
          expect(returned?.attachments[0].owned).toBe(false)
          expect(returned?.fitnessFile?.owned).toBe(false)
          expect(await getDraft('a')).toEqual(returned)
        }
      )

      it('keeps an existing lock message', async () => {
        await store(
          queued(
            'a',
            { state: 'couldnt_send', firstAttemptAt: 7 },
            { lockedMessage: 'kept' }
          )
        )
        expect((await unqueueDraft('a'))?.lockedMessage).toBe('kept')
      })

      it('leaves a never-attempted draft unlocked and its media owned', async () => {
        await store(queued('a', { state: 'waiting' }, { attachments }))
        const returned = await unqueueDraft('a')
        expect(returned?.lockedMessage).toBeUndefined()
        expect(returned?.attachments[0].owned).toBe(true)
      })
    })

    it('resolves undefined for a missing draft', async () => {
      expect(await unqueueDraft('gone')).toBeUndefined()
    })
  })

  describe('pauseQueue and resumeQueue', () => {
    it('pauses waiting and checking for this actor only', async () => {
      await store(queued('w'))
      await store(queued('c', { state: 'checking', firstAttemptAt: 3 }))
      await store(
        queued('s', { state: 'sending', claim: { tabId: 't', until: NOW } })
      )
      await store(queued('o', {}, { actorId: 'actor-2' }))
      expect(await pauseQueue({ actorId: 'actor-1' })).toBe(2)
      expect((await getDraft('w'))?.queue).toMatchObject({
        state: 'paused',
        pausedBy: 'user'
      })
      expect((await getDraft('c'))?.queue?.state).toBe('paused')
      expect((await getDraft('s'))?.queue?.state).toBe('sending')
      expect((await getDraft('o'))?.queue?.state).toBe('waiting')
    })

    it('resumes only the named pauses, to checking once attempted', async () => {
      await store(
        queued('auth', {
          state: 'paused',
          pausedBy: 'auth',
          firstAttemptAt: 3,
          nextAttemptAt: NOW,
          reason: 'Sign in'
        })
      )
      await store(queued('actor', { state: 'paused', pausedBy: 'actor' }))
      await store(queued('user', { state: 'paused', pausedBy: 'user' }))
      expect(
        await resumeQueue({ actorId: 'actor-1', pausedBy: ['auth', 'actor'] })
      ).toBe(2)
      expect((await getDraft('auth'))?.queue).toEqual({
        state: 'checking',
        queuedAt: 10,
        attempts: 0,
        firstAttemptAt: 3
      })
      expect((await getDraft('actor'))?.queue?.state).toBe('waiting')
      expect((await getDraft('user'))?.queue?.state).toBe('paused')
    })

    it('rewrites every item in one transaction: a later revision check sees the bump', async () => {
      const first = await store(queued('a'))
      await pauseQueue({ actorId: 'actor-1' })
      await expect(
        updateQueuedDraft('a', first.revision, (r) => r)
      ).rejects.toBeInstanceOf(DraftConflictError)
    })
  })

  it('a queue write after sign-out never resurrects the draft', async () => {
    const saved = await store(queued('a'))
    await deleteAccountDrafts('account-1')
    await expect(
      updateQueuedDraft('a', saved.revision, (r) => r)
    ).rejects.toBeInstanceOf(DraftConflictError)
    expect(await getDraft('a')).toBeUndefined()
  })
})

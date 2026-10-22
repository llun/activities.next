import { IDBFactory } from 'fake-indexeddb'

import { ApiRequestError } from '@/lib/client/http'
import { EXPECTED_ACTOR_MISMATCH_ERROR } from '@/lib/services/statuses/expectedActor'
import { createDeferred } from '@/lib/testing/deferred'
import type { Status } from '@/lib/types/domain/status'

import {
  DraftsUnavailableError,
  claimQueuedDraft,
  deleteDraftIfRevision,
  getDraft,
  getDraftBlob,
  listDrafts,
  renewClaim,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory,
  updateQueuedDraft
} from './draftsDb'
import {
  CHECKING_GIVE_UP_MS,
  CLAIM_LEASE_MS,
  DEFAULT_RETRY_AFTER_MS,
  MAX_QUEUE_AGE_MS,
  SEND_TIMEOUT_MS,
  type SendQueueDeps,
  classifySendOutcome,
  drainQueue,
  preflight
} from './sendQueue'
import { buildSubmitRequest } from './submitRequest'
import type { DraftQueueState, DraftRecord } from './types'

const NOW = 10_000_000

const draft = (
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
  text: `text ${id}`,
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  queue: { state: 'waiting', queuedAt: NOW - 1_000, attempts: 0, ...queue },
  ...patch
})

const uploaded = (patch: Partial<DraftRecord['attachments'][0]> = {}) => ({
  localId: 'local-1',
  mediaId: 'media-1',
  owned: true,
  mediaType: 'image/png',
  fileName: 'a.png',
  url: 'https://example.test/a.png',
  description: 'a cat',
  decorative: false,
  hasBlob: true,
  ...patch
})

const store = (record: DraftRecord) =>
  saveDraft(record, { expectedRevision: 0, epoch: 0 })

type CreateNote = SendQueueDeps['createNote']
type Readable = Awaited<ReturnType<SendQueueDeps['getStatusIfReadable']>>
type Settings = Awaited<ReturnType<SendQueueDeps['getGallerySettings']>>

// Rejects with the signal's reason once aborted, like `fetch`.
const untilAborted: CreateNote = ({ signal }) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason))
  })

let clock = NOW

const makeDeps = (overrides: Partial<SendQueueDeps> = {}): SendQueueDeps => ({
  listDrafts,
  claimQueuedDraft,
  updateQueuedDraft,
  renewClaim,
  deleteDraftIfRevision,
  getDraftBlob,
  createNote: vi.fn<CreateNote>().mockResolvedValue({} as never),
  createPoll: vi
    .fn<SendQueueDeps['createPoll']>()
    .mockResolvedValue({} as never),
  getStatusIfReadable: vi.fn(async (id: string) => ({ id }) as Readable),
  getGallerySettings: vi.fn(
    async () => ({ allowEmptyDescription: true }) as Settings
  ),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn(),
  deleteUnpostedMedia: vi.fn(),
  deleteUnpostedFitnessFile: vi.fn(),
  isOnline: () => true,
  reportRequestFailure: vi.fn(),
  announce: vi.fn(),
  now: () => clock,
  ...overrides
})

const drain = (
  deps: SendQueueDeps,
  {
    signal = new AbortController().signal,
    onProgress = vi.fn()
  }: { signal?: AbortSignal; onProgress?: () => void } = {}
) =>
  drainQueue({
    accountId: 'account-1',
    actorId: 'actor-1',
    epoch: 0,
    tabId: 'tab-a',
    signal,
    deps,
    onProgress
  })

// `vi.waitFor` advances fake timers; this waits on real macrotasks only
// (fake-indexeddb settles through `setImmediate`, which stays real).
const settle = async (check: () => unknown) => {
  for (let i = 0; i < 200 && !check(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(check()).toBeTruthy()
}

const apiError = (status: number, message = 'bad', retryAfterMs?: number) =>
  new ApiRequestError(message, status, retryAfterMs)

describe('classifySendOutcome', () => {
  const posted = draft('a', { attempts: 1, firstAttemptAt: NOW - 10 })
  const locked = { ...posted, lockedMessage: 'Kept.' }
  const timeout = new DOMException('timed out', 'TimeoutError')
  const abort = new DOMException('aborted', 'AbortError')
  const KEPT_503 =
    "Your post was saved but couldn't be sent yet. Press Post again to retry."

  it.each([
    [
      '409 actor mismatch',
      apiError(409, EXPECTED_ACTOR_MISMATCH_ERROR),
      posted,
      false,
      {
        kind: 'paused',
        pausedBy: 'actor',
        reason: 'Signed in as a different profile'
      }
    ],
    [
      '409 in flight',
      apiError(409, 'busy'),
      posted,
      false,
      {
        kind: 'checking',
        nextAttemptAt: NOW + 5_000,
        lockedMessage: 'Your post is still being sent. Please wait a moment.'
      }
    ],
    [
      '401',
      apiError(401),
      posted,
      false,
      { kind: 'paused', pausedBy: 'auth', reason: 'Sign in again to send it' }
    ],
    [
      '429 with Retry-After',
      apiError(429, 'slow', 7_000),
      posted,
      false,
      {
        kind: 'paused',
        pausedBy: 'rate_limit',
        reason: 'Too many posts. Trying again soon.',
        nextAttemptAt: NOW + 7_000
      }
    ],
    [
      '429 without Retry-After',
      apiError(429),
      posted,
      false,
      {
        kind: 'paused',
        pausedBy: 'rate_limit',
        reason: 'Too many posts. Trying again soon.',
        nextAttemptAt: NOW + DEFAULT_RETRY_AFTER_MS
      }
    ],
    [
      'pre-flight TypeError',
      new TypeError('Load failed'),
      posted,
      true,
      { kind: 'waiting', nextAttemptAt: NOW + 15_000 }
    ],
    [
      'pre-flight AbortError',
      abort,
      posted,
      true,
      { kind: 'waiting', nextAttemptAt: NOW + 15_000 }
    ],
    [
      'pre-flight 503',
      apiError(503),
      posted,
      true,
      { kind: 'waiting', nextAttemptAt: NOW + 15_000 }
    ],
    [
      'TypeError',
      new TypeError('Load failed'),
      posted,
      false,
      { kind: 'checking', nextAttemptAt: NOW + 5_000 }
    ],
    [
      'TimeoutError',
      timeout,
      posted,
      false,
      { kind: 'checking', nextAttemptAt: NOW + 5_000 }
    ],
    [
      '500',
      apiError(500),
      posted,
      false,
      { kind: 'checking', nextAttemptAt: NOW + 5_000 }
    ],
    [
      '503 locks',
      apiError(503),
      posted,
      false,
      { kind: 'checking', nextAttemptAt: NOW + 5_000, lockedMessage: KEPT_503 }
    ],
    [
      '404',
      apiError(404),
      posted,
      false,
      {
        kind: 'needs_review',
        reason: 'The post you replied to or quoted is gone or hidden.'
      }
    ],
    [
      '410 clears the key',
      apiError(410),
      locked,
      false,
      {
        kind: 'needs_review',
        reason:
          'This post was sent and then deleted. Check it, then send it again.',
        clearSubmit: true
      }
    ],
    [
      '400 after the POST locks (amendment 4)',
      apiError(400, 'Oops.'),
      posted,
      false,
      {
        kind: 'couldnt_send',
        reason: 'Oops.',
        lockedMessage:
          "Couldn't send your saved post (Oops). Press Post to retry or discard the draft."
      }
    ],
    [
      '400 before any POST',
      apiError(400, 'Oops.'),
      posted,
      true,
      { kind: 'couldnt_send', reason: 'Oops.' }
    ],
    [
      '403',
      apiError(403, 'Forbidden'),
      posted,
      false,
      { kind: 'couldnt_send', reason: 'Forbidden' }
    ],
    [
      '413',
      apiError(413, 'Too large'),
      posted,
      false,
      { kind: 'couldnt_send', reason: 'Too large' }
    ],
    [
      '422',
      apiError(422, 'Text too long'),
      posted,
      false,
      { kind: 'couldnt_send', reason: 'Text too long' }
    ],
    [
      '422 on a locked draft keeps it locked',
      apiError(422, 'Text too long'),
      locked,
      false,
      {
        kind: 'couldnt_send',
        reason: 'Text too long',
        lockedMessage:
          "Couldn't send your saved post (Text too long). Press Post to retry or discard the draft."
      }
    ],
    [
      'a client-side throw',
      new Error('boom'),
      posted,
      false,
      { kind: 'couldnt_send', reason: 'boom' }
    ],
    [
      'a non-error',
      'weird',
      posted,
      false,
      { kind: 'couldnt_send', reason: 'Something went wrong.' }
    ]
  ] as const)('%s', (_name, error, record, isPreflight, expected) => {
    expect(
      classifySendOutcome(error, record, { now: NOW, preflight: isPreflight })
    ).toEqual(expected)
  })

  it('names the reply box way out for a locked reply', () => {
    const reply = { ...posted, composer: 'reply-box' as const }
    expect(
      classifySendOutcome(apiError(400, 'Oops.'), reply, { now: NOW })
    ).toMatchObject({
      lockedMessage: expect.stringContaining('cancel the reply')
    })
  })
})

describe('preflight', () => {
  const reply = (patch: Partial<DraftRecord> = {}) =>
    draft(
      'a',
      {},
      {
        replyTo: { id: 'target' } as Status,
        updatedAt: 5_000_500,
        ...patch
      }
    )

  it.each([
    [MAX_QUEUE_AGE_MS, null],
    [
      MAX_QUEUE_AGE_MS + 1,
      {
        kind: 'needs_review',
        reason: 'Waited more than 24 hours. Check it, then send it.'
      }
    ]
  ])('a draft queued %i ms ago → %j', async (age, expected) => {
    const record = draft('a', { queuedAt: NOW - age })
    expect(await preflight(record, makeDeps(), NOW)).toEqual(expected)
  })

  it('sends a video without an id to Needs review', async () => {
    const record = draft(
      'a',
      {},
      {
        attachments: [uploaded({ mediaType: 'video/mp4', mediaId: undefined })]
      }
    )
    expect(await preflight(record, makeDeps(), NOW)).toMatchObject({
      kind: 'needs_review',
      reason: 'Videos stay as drafts.'
    })
  })

  it('needs review when the reply target is gone or hidden', async () => {
    const deps = makeDeps({ getStatusIfReadable: vi.fn(async () => null) })
    expect(await preflight(reply(), deps, NOW)).toMatchObject({
      kind: 'needs_review',
      reason: 'The post you replied to is gone or hidden.'
    })
  })

  it('needs review when the quoted post is gone', async () => {
    const deps = makeDeps({ getStatusIfReadable: vi.fn(async () => null) })
    const record = draft('a', {}, { quoteOf: { id: 'q' } as Status })
    expect(await preflight(record, deps, NOW)).toMatchObject({
      reason: 'The post you quoted is gone or hidden.'
    })
  })

  it.each([
    // updatedAt 5_000_500 ms is second 5000.
    ['a later second', new Date(5_001_000).toISOString(), 'edited'],
    ['the same second', new Date(5_000_999).toISOString(), null]
  ])('a target edited in %s', async (_name, editedAt, expected) => {
    const deps = makeDeps({
      getStatusIfReadable: vi.fn(
        async () => ({ id: 'target', edited_at: editedAt }) as Readable
      )
    })
    const outcome = await preflight(reply(), deps, NOW)
    if (expected) {
      expect(outcome).toMatchObject({
        reason: 'The post you replied to was edited since you wrote this.'
      })
    } else {
      expect(outcome).toBeNull()
    }
  })

  it('needs review when quoting is no longer allowed', async () => {
    const deps = makeDeps({
      getStatusIfReadable: vi.fn(
        async () =>
          ({
            id: 'q',
            quote_approval: {
              automatic: [],
              manual: [],
              current_user: 'denied'
            }
          }) as unknown as Readable
      )
    })
    const record = draft('a', {}, { quoteOf: { id: 'q' } as Status })
    expect(await preflight(record, deps, NOW)).toMatchObject({
      reason: "Quoting this post isn't allowed any more."
    })
  })

  it('needs a description when the instance requires one', async () => {
    const deps = makeDeps({
      getGallerySettings: vi.fn(
        async () => ({ allowEmptyDescription: false }) as Settings
      )
    })
    const missing = draft(
      'a',
      {},
      {
        attachments: [uploaded({ description: '  ' })]
      }
    )
    const decorative = draft(
      'b',
      {},
      {
        attachments: [uploaded({ description: '', decorative: true })]
      }
    )
    expect(await preflight(missing, deps, NOW)).toMatchObject({
      reason: 'Add a description to each photo, then send it.'
    })
    expect(await preflight(decorative, deps, NOW)).toBeNull()
  })

  it('pauses on a settings 401 and fails open on a settings 500', async () => {
    const record = draft(
      'a',
      {},
      {
        attachments: [uploaded({ description: '' })]
      }
    )
    const unauthorized = makeDeps({
      getGallerySettings: vi.fn(async () => {
        throw apiError(401)
      })
    })
    const broken = makeDeps({
      getGallerySettings: vi.fn(async () => {
        throw apiError(500)
      })
    })
    expect(await preflight(record, unauthorized, NOW)).toMatchObject({
      kind: 'paused',
      pausedBy: 'auth'
    })
    expect(await preflight(record, broken, NOW)).toBeNull()
  })

  it('a network failure waits, never checks', async () => {
    const deps = makeDeps({
      getStatusIfReadable: vi.fn(async () => {
        throw new TypeError('Load failed')
      })
    })
    expect(await preflight(reply(), deps, NOW)).toEqual({
      kind: 'waiting',
      nextAttemptAt: NOW + 5_000
    })
  })
})

describe('drainQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
    clock = NOW
    setDraftsIndexedDBFactory(new IDBFactory())
  })

  afterEach(() => {
    vi.useRealTimers()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
  })

  it('sends oldest first, only this actor, and deletes each sent draft', async () => {
    await store(draft('late', { queuedAt: NOW - 10 }))
    await store(draft('early', { queuedAt: NOW - 30 }))
    await store(draft('middle', { queuedAt: NOW - 20 }))
    await store(draft('other', {}, { actorId: 'actor-2' }))
    await store({ ...draft('plain'), queue: undefined })
    const deps = makeDeps()
    const onProgress = vi.fn()

    const result = await drain(deps, { onProgress })

    expect(
      vi.mocked(deps.createNote).mock.calls.map(([params]) => params.message)
    ).toEqual(['text early', 'text middle', 'text late'])
    expect(result).toMatchObject({ attempted: 3, sent: 3 })
    expect(await getDraft('early')).toBeUndefined()
    expect(await getDraft('other')).toBeDefined()
    expect(await getDraft('plain')).toBeDefined()
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'sending', index: 2, total: 3 })
    )
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'result', sent: 3 })
    )
    expect(deps.announce).toHaveBeenCalledWith('early')
  })

  it('reports idle when nothing was claimable', async () => {
    const onProgress = vi.fn()
    await drain(makeDeps(), { onProgress })
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'idle' })
    )
  })

  it('sends a poll through createPoll with the actor header', async () => {
    await store(
      draft(
        'a',
        {},
        {
          poll: {
            choices: ['x', 'y'],
            durationInSeconds: 3600,
            pollType: 'oneOf'
          }
        }
      )
    )
    const deps = makeDeps()
    await drain(deps)
    expect(deps.createPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: ['x', 'y'],
        expectedActorId: 'actor-1',
        idempotencyKey: expect.any(String)
      })
    )
    expect(deps.createNote).not.toHaveBeenCalled()
  })

  describe('the Idempotency-Key', () => {
    it('reuses a matching submit key', async () => {
      const record = draft('a')
      const { fingerprint } = buildSubmitRequest(record)
      await store({ ...record, submit: { key: 'kept-key', fingerprint } })
      const deps = makeDeps()
      await drain(deps)
      expect(deps.createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'kept-key',
          expectedActorId: 'actor-1'
        })
      )
    })

    it('mints and persists a new key before the POST when the content changed', async () => {
      await store(
        draft('a', {}, { submit: { key: 'old-key', fingerprint: 'stale' } })
      )
      const seen: Array<DraftRecord | undefined> = []
      const deps = makeDeps({
        createNote: vi.fn<CreateNote>(async () => {
          seen.push(await getDraft('a'))
          return {} as never
        })
      })

      await drain(deps)

      const sentKey = vi.mocked(deps.createNote).mock.calls[0][0].idempotencyKey
      expect(sentKey).toBeTruthy()
      expect(sentKey).not.toBe('old-key')
      expect(seen[0]).toMatchObject({
        submit: { key: sentKey },
        attemptedAt: NOW,
        queue: { state: 'sending', attempts: 1, firstAttemptAt: NOW }
      })
    })

    it('sends the same key on every retry, and checking skips the pre-flight', async () => {
      await store(draft('a', {}, { replyTo: { id: 'target' } as Status }))
      const createNote = vi
        .fn<CreateNote>()
        .mockRejectedValueOnce(new TypeError('Load failed'))
        .mockResolvedValueOnce({} as never)
      const deps = makeDeps({ createNote })

      await drain(deps)
      expect((await getDraft('a'))?.queue).toMatchObject({
        state: 'checking',
        attempts: 1,
        nextAttemptAt: NOW + 5_000
      })
      expect(deps.reportRequestFailure).toHaveBeenCalled()

      clock = NOW + 5_000
      await drain(deps)

      const [first, second] = createNote.mock.calls.map(
        ([p]) => p.idempotencyKey
      )
      expect(second).toBe(first)
      expect(deps.getStatusIfReadable).toHaveBeenCalledTimes(1)
      expect(await getDraft('a')).toBeUndefined()
    })

    it('does not POST when the checkpoint write fails', async () => {
      await store(draft('a'))
      const deps = makeDeps({
        updateQueuedDraft: vi.fn(async () => {
          throw new DraftsUnavailableError('disk')
        })
      })
      const result = await drain(deps)
      expect(deps.createNote).not.toHaveBeenCalled()
      expect(result.sent).toBe(0)
      // Nothing written: the lease expires and a later drain reclaims it.
      expect((await getDraft('a'))?.queue).toMatchObject({
        state: 'sending',
        attempts: 0
      })
    })
  })

  describe('outcomes', () => {
    it('400 after the POST: locked, same key, media not owned (amendment 4)', async () => {
      await store(
        draft(
          'a',
          {},
          {
            attachments: [uploaded()],
            fitnessFile: {
              localId: 'fit',
              fileName: 'run.fit',
              mimeType: 'application/octet-stream',
              size: 1,
              fitnessFileId: 'fit-1',
              owned: true,
              hasBlob: true
            }
          }
        )
      )
      const deps = makeDeps({
        createNote: vi
          .fn<CreateNote>()
          .mockRejectedValue(apiError(400, 'Oops.'))
      })

      const result = await drain(deps)

      const sentKey = vi.mocked(deps.createNote).mock.calls[0][0].idempotencyKey
      const stored = await getDraft('a')
      expect(result.failed).toBe(1)
      expect(stored).toMatchObject({
        submit: { key: sentKey },
        lockedMessage: expect.stringContaining("Couldn't send your saved post"),
        attachments: [expect.objectContaining({ owned: false })],
        fitnessFile: expect.objectContaining({ owned: false }),
        queue: { state: 'couldnt_send', reason: 'Oops.' }
      })
      expect(stored?.queue).not.toHaveProperty('claim')
    })

    it('503: checking, locked, media not owned', async () => {
      await store(draft('a', {}, { attachments: [uploaded()] }))
      const deps = makeDeps({
        createNote: vi.fn<CreateNote>().mockRejectedValue(apiError(503))
      })
      await drain(deps)
      expect(await getDraft('a')).toMatchObject({
        lockedMessage: expect.stringContaining('saved'),
        attachments: [expect.objectContaining({ owned: false })],
        queue: { state: 'checking', nextAttemptAt: NOW + 5_000 }
      })
    })

    it('410: needs review, unlocked, the key dropped', async () => {
      await store(
        draft(
          'a',
          {},
          {
            lockedMessage: 'Kept.',
            submit: { key: 'k', fingerprint: 'stale' }
          }
        )
      )
      const deps = makeDeps({
        createNote: vi.fn<CreateNote>().mockRejectedValue(apiError(410))
      })
      const result = await drain(deps)
      const stored = await getDraft('a')
      expect(result.needsReview).toBe(1)
      expect(stored?.queue?.state).toBe('needs_review')
      expect(stored).not.toHaveProperty('submit')
      expect(stored).not.toHaveProperty('lockedMessage')
    })

    it('paused(auth) stops the rest of the drain', async () => {
      await store(draft('first', { queuedAt: NOW - 20 }))
      await store(draft('second', { queuedAt: NOW - 10 }))
      const deps = makeDeps({
        createNote: vi.fn<CreateNote>().mockRejectedValue(apiError(401))
      })
      const result = await drain(deps)
      expect(deps.createNote).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ attempted: 1, paused: 1 })
      expect((await getDraft('first'))?.queue).toMatchObject({
        state: 'paused',
        pausedBy: 'auth'
      })
      expect((await getDraft('second'))?.queue?.state).toBe('waiting')
    })

    it('counts a sent post even when deleting the draft fails', async () => {
      await store(draft('a'))
      const deps = makeDeps({
        deleteDraftIfRevision: vi.fn(async () => {
          throw new DraftsUnavailableError('disk')
        })
      })
      expect((await drain(deps)).sent).toBe(1)
    })

    it.each([
      [CHECKING_GIVE_UP_MS, 'sent'],
      [CHECKING_GIVE_UP_MS + 1, 'needs_review']
    ])('gives up checking after %i ms', async (age, expected) => {
      await store(
        draft('a', {
          state: 'checking',
          attempts: 2,
          firstAttemptAt: NOW - age
        })
      )
      const deps = makeDeps()
      await drain(deps)
      if (expected === 'sent') {
        expect(deps.createNote).toHaveBeenCalled()
        expect(await getDraft('a')).toBeUndefined()
      } else {
        expect(deps.createNote).not.toHaveBeenCalled()
        expect((await getDraft('a'))?.queue).toMatchObject({
          state: 'needs_review',
          reason:
            "We couldn't confirm whether it posted. Check your profile before sending it again."
        })
      }
    })

    it('an attachment without an id cannot be sent yet (V2b)', async () => {
      await store(
        draft('a', {}, { attachments: [uploaded({ mediaId: undefined })] })
      )
      const deps = makeDeps()
      await drain(deps)
      expect(deps.createNote).not.toHaveBeenCalled()
      expect((await getDraft('a'))?.queue?.state).toBe('couldnt_send')
    })
  })

  describe('timers and aborts', () => {
    it('times the POST out at SEND_TIMEOUT_MS and goes to checking', async () => {
      await store(draft('a'))
      const deps = makeDeps({ createNote: vi.fn<CreateNote>(untilAborted) })
      const running = drain(deps)
      await settle(() => vi.mocked(deps.createNote).mock.calls.length)
      const signal = vi.mocked(deps.createNote).mock.calls[0][0].signal

      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(true)
      await running

      expect((await getDraft('a'))?.queue).toMatchObject({
        state: 'checking',
        attempts: 1,
        nextAttemptAt: NOW + 5_000
      })
    })

    it('renews the lease every third of it while the POST is in flight', async () => {
      await store(draft('a'))
      const pending = createDeferred<never>()
      const renew = vi.fn(renewClaim)
      const deps = makeDeps({
        renewClaim: renew,
        createNote: vi.fn<CreateNote>(() => pending.promise)
      })
      const running = drain(deps)
      await settle(() => vi.mocked(deps.createNote).mock.calls.length)

      clock = NOW + 1_000
      await vi.advanceTimersByTimeAsync(CLAIM_LEASE_MS / 3 - 1)
      expect(renew).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await settle(() => renew.mock.results[0])
      await renew.mock.results[0].value
      expect((await getDraft('a'))?.queue?.claim?.until).toBe(
        NOW + 1_000 + CLAIM_LEASE_MS
      )
      expect(renew).toHaveBeenCalledWith('a', {
        tabId: 'tab-a',
        until: NOW + 1_000 + CLAIM_LEASE_MS
      })

      pending.resolve({} as never)
      await running
      expect(await getDraft('a')).toBeUndefined()
    })

    it('an abort mid-POST releases the claim to checking and stops the drain', async () => {
      await store(draft('first', { queuedAt: NOW - 20 }))
      const second = await store(draft('second', { queuedAt: NOW - 10 }))
      const controller = new AbortController()
      const onProgress = vi.fn()
      const deps = makeDeps({ createNote: vi.fn<CreateNote>(untilAborted) })
      const running = drain(deps, { signal: controller.signal, onProgress })
      await settle(() => vi.mocked(deps.createNote).mock.calls.length)

      controller.abort()
      await running

      const first = await getDraft('first')
      expect(first?.queue).toMatchObject({ state: 'checking', attempts: 1 })
      expect(first?.queue).not.toHaveProperty('claim')
      expect(await getDraft('second')).toEqual(second)
      expect(deps.createNote).toHaveBeenCalledTimes(1)
      expect(deps.reportRequestFailure).not.toHaveBeenCalled()
      expect(onProgress).not.toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'result' })
      )
    })

    it('an abort during the pre-flight releases the claim to waiting', async () => {
      await store(draft('a', {}, { replyTo: { id: 'target' } as Status }))
      const controller = new AbortController()
      const deps = makeDeps({
        getStatusIfReadable: vi.fn(
          (_id: string, { signal }: { signal?: AbortSignal } = {}) =>
            new Promise<Readable>((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason))
            })
        )
      })
      const running = drain(deps, { signal: controller.signal })
      await settle(() => vi.mocked(deps.getStatusIfReadable).mock.calls.length)

      controller.abort()
      await running

      const stored = await getDraft('a')
      expect(stored?.queue).toEqual({
        state: 'waiting',
        queuedAt: NOW - 1_000,
        attempts: 0
      })
      expect(deps.createNote).not.toHaveBeenCalled()
    })

    it('claims nothing once aborted or offline', async () => {
      await store(draft('a'))
      const controller = new AbortController()
      controller.abort()
      const offline = makeDeps({ isOnline: () => false })
      const aborted = makeDeps()
      expect((await drain(offline)).attempted).toBe(0)
      expect(
        (await drain(aborted, { signal: controller.signal })).attempted
      ).toBe(0)
      expect((await getDraft('a'))?.queue?.state).toBe('waiting')
    })
  })
})

import { NextRequest } from 'next/server'

import { StatusPublishFailedError } from '@/lib/database/domains/idempotency/types'
import { Database } from '@/lib/database/types'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { DELETE, POST } from './route'

const mockCreateNoteFromUserInput = vi.fn()
const mockCreatePollFromUserInput = vi.fn()
const mockDeleteStatusFromUserInput = vi.fn()
vi.mock('@/lib/actions/deleteStatus', () => ({
  deleteStatusFromUserInput: (...args: unknown[]) =>
    mockDeleteStatusFromUserInput(...args)
}))
const mockResolveQuoteForCreate = vi.fn()
const mockGetServerSession = vi.fn()
vi.mock('@/lib/actions/createNote', () => ({
  createNoteFromUserInput: (...args: unknown[]) =>
    mockCreateNoteFromUserInput(...args)
}))
vi.mock('@/lib/actions/createPoll', () => ({
  createPollFromUserInput: (...args: unknown[]) =>
    mockCreatePollFromUserInput(...args)
}))
vi.mock('@/lib/services/quotes/resolveQuoteForCreate', () => ({
  resolveQuoteForCreate: (...args: unknown[]) =>
    mockResolveQuoteForCreate(...args)
}))

// The remote fetch path getReadableStatusForAction drives for an unstored
// reply target, and the store step behind it.
const { mockGetNote, mockDispatchCreateNoteOrPollJob } = vi.hoisted(() => ({
  mockGetNote: vi.fn(),
  mockDispatchCreateNoteOrPollJob: vi.fn()
}))
vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return { ...actual, getNote: mockGetNote }
})
vi.mock('@/lib/jobs/dispatchCreateNoteOrPollJob', () => ({
  dispatchCreateNoteOrPollJob: mockDispatchCreateNoteOrPollJob
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// The stored-parent view the dispatch mock maintains: the store step writes the
// fetched note under its CANONICAL id (the note's own `id`), never under the
// permalink alias the client sent.
const storedRemoteParents = new Map<string, unknown>()

const mockDatabase = {
  getAllServerSettings: vi.fn(),
  getStatus: vi.fn(
    async ({ statusId }: { statusId: string }) =>
      storedRemoteParents.get(statusId) ?? null
  ),
  getDomainBlockForDomain: vi.fn().mockResolvedValue(null)
}
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

// `attachments.mediaId` is `integer` on PostgreSQL, so a fixture id has to be
// a value the column can actually hold — `media-0` never could, and only
// SQLite's dynamic typing let it pass.
const buildAttachments = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'upload' as const,
    id: `${index + 1}`,
    mediaType: 'image/png',
    url: `https://test.llun.dev/medias/${index}.png`,
    width: 100,
    height: 100
  }))

// A shape complete enough for the route's 200 response serialization
// (toActivityPubObject) to succeed on the stubbed create-action return.
const buildNoteStatus = (id: string, replyTo?: string) => ({
  id,
  type: 'Note',
  actorId: 'https://test.llun.dev/users/test1',
  actor: null,
  isLocalActor: true,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  url: id,
  text: 'a remote reply',
  summary: null,
  reply: replyTo ?? '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
})

const testAccount = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: 'https://test.llun.dev/users/test1',
  createdAt: Date.now(),
  updatedAt: Date.now()
}

describe('POST /api/v1/accounts/outbox', () => {
  beforeEach(() => {
    mockCreateNoteFromUserInput.mockReset()
    mockCreateNoteFromUserInput.mockResolvedValue({
      id: 'note-status',
      attachments: []
    })
    mockCreatePollFromUserInput.mockReset()
    mockCreatePollFromUserInput.mockResolvedValue({ id: 'poll-status' })
    mockResolveQuoteForCreate.mockReset()
    mockResolveQuoteForCreate.mockResolvedValue({
      ok: true,
      quotedStatusId: undefined,
      quoteApprovalPolicy: undefined
    })
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue(seedActor1)
    mockDatabase.getAllServerSettings.mockReset()
    mockDatabase.getAllServerSettings.mockResolvedValue([])
    storedRemoteParents.clear()
    mockGetNote.mockReset()
    mockDispatchCreateNoteOrPollJob.mockReset()
    mockDispatchCreateNoteOrPollJob.mockImplementation(
      async (_database: Database, note: { id: string }) => {
        storedRemoteParents.set(note.id, {
          id: note.id,
          type: 'Note',
          actorId: 'https://remote.test/users/alice',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      }
    )
    // The resolver caches per database instance, and this mock is shared across
    // the file, so drop the cached view between cases.
    invalidateServerSettingsCache(mockDatabase as unknown as Database)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: '{',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })

  it('returns 422 when a note request fails validation in the action', async () => {
    mockCreateNoteFromUserInput.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'Direct note without recipients',
        visibility: 'direct'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'Unprocessable entity'
    })
  })

  it('returns 503 with the saved-but-not-sent error when the note could not be queued', async () => {
    mockCreateNoteFromUserInput.mockRejectedValueOnce(
      new StatusPublishFailedError(false)
    )
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({ type: 'note', message: 'Saved but not sent' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: 'Your post was saved but could not be sent'
    })
  })

  it('passes an authorized quote through to the create action', async () => {
    mockResolveQuoteForCreate.mockResolvedValueOnce({
      ok: true,
      quotedStatusId: 'https://llun.test/users/alice/statuses/1',
      quoteApprovalPolicy: 'followers'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'quoting you',
        quotedStatusId: 'https://llun.test/users/alice/statuses/1',
        quoteApprovalPolicy: 'followers'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    await POST(req, { params: Promise.resolve({}) })

    // The route authorized the quote (resolveQuoteForCreate ok) and forwarded
    // the resolved target + policy to the create action.
    expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        quotedStatusId: 'https://llun.test/users/alice/statuses/1',
        quoteApprovalPolicy: 'followers'
      })
    )
  })

  it('resolves quoted status id param before passing to resolveQuoteForCreate', async () => {
    mockResolveQuoteForCreate.mockResolvedValueOnce({
      ok: true,
      quotedStatusId: 'https://llun.test/users/alice/statuses/1',
      quoteApprovalPolicy: 'public'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'quoting with param id',
        quotedStatusId: 'https://llun.test/users/alice/statuses/1'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    await POST(req, { params: Promise.resolve({}) })

    expect(mockResolveQuoteForCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        quotedStatusId: 'https://llun.test/users/alice/statuses/1'
      })
    )
  })

  it('returns 404 when the quote target is not found or unreadable', async () => {
    mockResolveQuoteForCreate.mockResolvedValueOnce({
      ok: false,
      reason: 'not_found'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'quoting a hidden post',
        quotedStatusId: 'https://llun.test/users/alice/statuses/secret'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(404)
    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
  })

  it('returns 422 when the quote policy denies the caller', async () => {
    mockResolveQuoteForCreate.mockResolvedValueOnce({
      ok: false,
      reason: 'denied'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'quoting a no-quote post',
        quotedStatusId: 'https://llun.test/users/alice/statuses/nobody'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
  })

  // The outbox route must behave like POST /api/v1/statuses for replies:
  // getReadableStatusForAction fetches and stores an unstored remote public
  // parent, and the create action receives the parent id the lookup RETURNED
  // (the canonical AP id the note was stored under), not the permalink alias
  // the client sent.
  it('stores an unstored remote public reply target and replies to its canonical id', async () => {
    const remoteActorId = 'https://remote.test/users/alice'
    const canonicalParentId =
      'https://remote.test/users/alice/statuses/route-outbox-remote-reply-1'
    const requestedPermalink =
      'https://remote.test/@alice/route-outbox-remote-reply-1'
    mockGetNote.mockResolvedValueOnce({
      id: canonicalParentId,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'remote parent to reply to',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })
    mockCreateNoteFromUserInput.mockResolvedValueOnce(
      buildNoteStatus('route-outbox-remote-reply', canonicalParentId)
    )

    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'a remote reply',
        inReplyToId: requestedPermalink
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: canonicalParentId })
    )
    expect(storedRemoteParents.get(canonicalParentId)).toBeDefined()
    expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ replyNoteId: canonicalParentId })
    )
  })

  it('returns 422 when a poll request fails validation in the action', async () => {
    mockCreatePollFromUserInput.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'poll',
        message: 'Private poll without recipients',
        choices: ['A', 'B'],
        durationInSeconds: 300,
        visibility: 'direct'
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'Unprocessable entity'
    })
  })

  // This route is deprecated and kept for backward compatibility, but it still
  // enforces the same posts.maxCharacters / polls.* limits as
  // POST /api/v1/statuses.
  it.each([
    {
      description: 'rejects a note past the configured post length',
      maxCharacters: 100,
      messageLength: 120,
      expectedRejected: true
    },
    {
      description:
        'lets a note past the old hardcoded 500 through when the limit is raised',
      maxCharacters: 1000,
      messageLength: 700,
      expectedRejected: false
    }
  ])(
    '$description',
    async ({ maxCharacters, messageLength, expectedRejected }) => {
      mockDatabase.getAllServerSettings.mockResolvedValue([
        { key: 'posts.maxCharacters', value: maxCharacters }
      ])
      const message = 'a'.repeat(messageLength)
      const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
        method: 'POST',
        body: JSON.stringify({ type: 'note', message }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://test.llun.dev'
        }
      })

      const res = await POST(req, { params: Promise.resolve({}) })

      if (expectedRejected) {
        expect(res.status).toBe(422)
        expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
        return
      }
      // Assert on what the gate forwarded rather than the response status: the
      // create action is stubbed, so the response shape says nothing about
      // whether the limit check passed.
      expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
        expect.objectContaining({ text: message })
      )
    }
  )

  it('returns the limit message when a note exceeds the configured post length', async () => {
    mockDatabase.getAllServerSettings.mockResolvedValue([
      { key: 'posts.maxCharacters', value: 100 }
    ])
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({ type: 'note', message: 'a'.repeat(120) }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    await expect(res.json()).resolves.toEqual({
      error: 'Text character limit of 100 exceeded'
    })
  })

  it('rejects a poll with more choices than the configured limit', async () => {
    mockDatabase.getAllServerSettings.mockResolvedValue([
      { key: 'polls.maxOptions', value: 2 }
    ])
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'poll',
        message: 'pick one',
        choices: ['a', 'b', 'c'],
        durationInSeconds: 3_600
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    expect(mockCreatePollFromUserInput).not.toHaveBeenCalled()
  })

  // The outbox route maps every attachment straight into a
  // database.createAttachment insert, so an unbounded list is an unbounded
  // fan-out of writes. It caps at the same fixed MAX_STORED_MEDIA_ATTACHMENTS
  // ceiling POST /api/v1/statuses and PUT /api/v1/statuses/:id use, so the
  // three create/edit paths agree on what a status may store.
  it.each([
    {
      description: 'rejects a note carrying more attachments than the ceiling',
      attachmentCount: MAX_STORED_MEDIA_ATTACHMENTS + 1,
      expectedRejected: true
    },
    {
      description: 'accepts a note carrying exactly the ceiling',
      attachmentCount: MAX_STORED_MEDIA_ATTACHMENTS,
      expectedRejected: false
    }
  ])('$description', async ({ attachmentCount, expectedRejected }) => {
    const attachments = buildAttachments(attachmentCount)
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'a note with media',
        attachments
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    if (expectedRejected) {
      // Assert the gate first: without the cap the route hands the whole
      // over-ceiling list to the create action, one insert per entry.
      expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toEqual({
        error: 'Unprocessable entity'
      })
      return
    }
    // The create action is stubbed, so assert on what the gate forwarded
    // rather than on the response status.
    expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ attachments })
    )
  })

  // `createNoteFromUserInput` hands `attachment.id` to
  // `database.createAttachment` as `mediaId`, and `attachments.mediaId` is
  // `integer` on PostgreSQL. Nothing between the route and that insert coerces
  // it, so a malformed id used to raise `invalid input syntax for type integer`
  // — a 500 rather than a 422, and raised AFTER `database.createNote` had
  // already committed the status row, since `createNote.ts` opens no
  // transaction. The user got an error and a published status whose media had
  // silently vanished. SQLite's dynamic typing simply stored the junk, which is
  // why CI (`TEST_DATABASE_TYPE=sqlite`) never saw it.
  //
  // The gate is asserted BEFORE the status code: the point is that the create
  // action is never reached, not merely that the response says 422.
  it.each([
    { description: 'a non-numeric id', id: 'abc' },
    // Accepted by PostgreSQL 16+ as a non-decimal integer literal, so this one
    // silently resolved a DIFFERENT row than the id names rather than erroring.
    { description: 'a hexadecimal id', id: '0x10' },
    { description: 'an exponent id', id: '1e3' },
    { description: 'an id past the integer ceiling', id: '2147483648' },
    { description: 'a signed id', id: '+12' },
    { description: 'a padded id', id: ' 12 ' },
    { description: 'an empty id', id: '' },
    { description: 'a negative id', id: '-1' },
    { description: 'a zero id', id: '0' }
  ])('rejects a note carrying $description', async ({ id }) => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'a note with media',
        attachments: [
          {
            type: 'upload',
            id,
            mediaType: 'image/png',
            url: 'https://test.llun.dev/medias/1.png',
            width: 100,
            height: 100
          }
        ]
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'Unprocessable entity'
    })
  })

  // The spellings a real client sends. `0012` is what a zero-padded id looks
  // like, and `12.0` is kept because `toMediaRowId` accepts it.
  it.each([
    { description: 'a plain row id', id: '12' },
    { description: 'a zero-padded row id', id: '0012' },
    { description: 'a trailing-zero-fraction row id', id: '12.0' }
  ])('accepts a note carrying $description', async ({ id }) => {
    const attachments = [
      {
        type: 'upload' as const,
        id,
        mediaType: 'image/png',
        url: 'https://test.llun.dev/medias/1.png',
        width: 100,
        height: 100
      }
    ]
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'a note with media',
        attachments
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    await POST(req, { params: Promise.resolve({}) })

    // The create action is stubbed, so assert on what the gate forwarded — and
    // that it forwarded the id UNCHANGED, since the guard validates the shape
    // rather than normalising it.
    expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ attachments })
    )
  })

  // The bound is deliberately the fixed ceiling, not the admin-configured
  // posts.maxMediaAttachments: that setting drives what the instance entity
  // advertises to clients, and POST/PUT /api/v1/statuses[/:id] do not enforce
  // it either. Enforcing it here alone would make the outbox route stricter
  // than the routes it is supposed to match.
  it('does not tighten the ceiling to the configured posts.maxMediaAttachments', async () => {
    mockDatabase.getAllServerSettings.mockResolvedValue([
      { key: 'posts.maxMediaAttachments', value: 2 }
    ])
    const attachments = buildAttachments(3)
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        message: 'three attachments, configured limit of two',
        attachments
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    await POST(req, { params: Promise.resolve({}) })

    expect(mockCreateNoteFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ attachments })
    )
  })

  it('returns 403 when actor is suspended', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: testAccount,
      suspendedAt: Date.now()
    })

    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({ type: 'note', message: 'hello' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
  })

  it('returns 403 when account is disabled', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: { ...testAccount, disabledAt: Date.now() }
    })

    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({ type: 'note', message: 'hello' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: {
        ...testAccount,
        verificationCode: 'pending-code',
        emailVerified: false
      }
    })

    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: JSON.stringify({ type: 'note', message: 'hello' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockCreateNoteFromUserInput).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/accounts/outbox', () => {
  beforeEach(() => {
    mockDeleteStatusFromUserInput.mockReset()
    mockCreatePollFromUserInput.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue(seedActor1)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: '{',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })

  // The other caller of the shared delete action, which owns the local delete
  // and the federation enqueue. Only the wiring is asserted here; the ordering
  // itself is covered in lib/actions/deleteStatus.test.ts.
  it('hands a valid delete to the shared delete action', async () => {
    mockDeleteStatusFromUserInput.mockResolvedValue(undefined)
    const statusId = 'https://test.llun.dev/users/test1/statuses/delete-me'
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: JSON.stringify({ statusId }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(mockDeleteStatusFromUserInput).toHaveBeenCalledWith(
      expect.objectContaining({ statusId, currentActor: seedActor1 })
    )
  })

  it('returns 403 when actor is suspended', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: testAccount,
      suspendedAt: Date.now()
    })

    const statusId = 'https://test.llun.dev/users/test1/statuses/delete-me'
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: JSON.stringify({ statusId }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDeleteStatusFromUserInput).not.toHaveBeenCalled()
  })

  it('returns 403 when account is disabled', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: { ...testAccount, disabledAt: Date.now() }
    })

    const statusId = 'https://test.llun.dev/users/test1/statuses/delete-me'
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: JSON.stringify({ statusId }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDeleteStatusFromUserInput).not.toHaveBeenCalled()
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockGetActorFromSession.mockResolvedValueOnce({
      ...seedActor1,
      account: {
        ...testAccount,
        verificationCode: 'pending-code',
        emailVerified: false
      }
    })

    const statusId = 'https://test.llun.dev/users/test1/statuses/delete-me'
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: JSON.stringify({ statusId }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://test.llun.dev'
      }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDeleteStatusFromUserInput).not.toHaveBeenCalled()
  })
})

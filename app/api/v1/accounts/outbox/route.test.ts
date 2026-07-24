import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, POST } from './route'

const mockCreateNoteFromUserInput = vi.fn()
const mockCreatePollFromUserInput = vi.fn()
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

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockDatabase = { getAllServerSettings: vi.fn() }
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue(seedActor1)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

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
    mockDatabase.getAllServerSettings.mockReset()
    mockDatabase.getAllServerSettings.mockResolvedValue([])
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

  // This is the endpoint the web composer creates through, so the resolved
  // posts.maxCharacters / polls.* limits have to be enforced here too — not
  // only on POST /api/v1/statuses.
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
})

describe('DELETE /api/v1/accounts/outbox', () => {
  beforeEach(() => {
    mockCreatePollFromUserInput.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
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
})

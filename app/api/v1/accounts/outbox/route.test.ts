import { NextRequest } from 'next/server'

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

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({})
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

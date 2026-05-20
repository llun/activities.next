import { NextRequest } from 'next/server'

import { seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, POST } from './route'

const mockCreateNoteFromUserInput = jest.fn()
const mockCreatePollFromUserInput = jest.fn()
const mockGetServerSession = jest.fn()
jest.mock('@/lib/actions/createNote', () => ({
  createNoteFromUserInput: (...args: unknown[]) =>
    mockCreateNoteFromUserInput(...args)
}))
jest.mock('@/lib/actions/createPoll', () => ({
  createPollFromUserInput: (...args: unknown[]) =>
    mockCreatePollFromUserInput(...args)
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue(seedActor1)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      status: 'Unprocessable entity'
    })
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
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      status: 'Unprocessable entity'
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
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })
})

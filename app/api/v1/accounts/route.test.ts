import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { GET, POST } from './route'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

type MockDatabase = Pick<
  Database,
  'getMastodonActorsFromIds' | 'isAccountExists' | 'isUsernameExists'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mastodonAccount = {
  id: 'account-id',
  username: 'alice',
  acct: 'alice',
  display_name: 'Alice'
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDatabase = {
    getMastodonActorsFromIds: jest.fn().mockResolvedValue([mastodonAccount]),
    isAccountExists: jest.fn().mockResolvedValue(false),
    isUsernameExists: jest.fn().mockResolvedValue(false)
  }
})

describe('GET /api/v1/accounts', () => {
  it('returns an empty array when no ids are provided', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(mockDatabase!.getMastodonActorsFromIds).not.toHaveBeenCalled()
  })

  it('returns the requested accounts for id[] params', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts?id[]=abc&id[]=def'
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([mastodonAccount])
    expect(mockDatabase!.getMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: expect.arrayContaining([expect.any(String)])
    })
  })

  it('also accepts plain id params', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts?id=abc')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([mastodonAccount])
  })
})

describe('POST /api/v1/accounts', () => {
  it('returns 422 (not 500) for a JSON body that fails validation', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: JSON.stringify({ username: 'a', email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })
})

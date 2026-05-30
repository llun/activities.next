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

  it('returns the requested accounts for id[] params and decodes the ids', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts?id[]=abc&id[]=def'
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([mastodonAccount])
    // Each encoded id is decoded via idToUrl before the DB lookup; a plain
    // (non-`apurl_`) value like `abc` decodes to `https://abc/`.
    expect(mockDatabase!.getMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://abc/', 'https://def/']
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
  it('declines JSON API clients with 501 and does not create an account', async () => {
    const createAccount = jest.fn()
    mockDatabase = {
      ...mockDatabase!,
      createAccount
    } as never
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        email: 'alice@example.com',
        password: 'password123'
      }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(501)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('declines Bearer-authenticated clients with 501', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Bearer sometoken'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(501)
  })
})

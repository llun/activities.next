import { NextRequest } from 'next/server'

import { GET } from './route'

describe('GET /api/v1/accounts/:id/identity_proofs', () => {
  it('returns an empty array (deprecated upstream)', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/abc/identity_proofs',
      { method: 'GET' }
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'abc' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

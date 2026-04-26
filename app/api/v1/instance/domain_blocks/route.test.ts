import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetDatabase = jest.fn()
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('GET /api/v1/instance/domain_blocks', () => {
  it('returns public Mastodon-shaped domain blocks', async () => {
    mockGetDatabase.mockReturnValue({
      getDomainBlocks: jest.fn().mockResolvedValue([
        {
          id: '1',
          type: 'block',
          domain: 'blocked.test',
          severity: 'suspend',
          rejectMedia: false,
          rejectReports: false,
          privateComment: 'internal',
          publicComment: 'spam',
          obfuscate: false,
          source: null,
          createdAt: 0,
          updatedAt: 0
        }
      ])
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/domain_blocks'),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual([
      {
        domain: 'blocked.test',
        digest:
          'cc5ac927c0bbef58bde4777f9afc52f3ed6c8d0652af02e650d33035030398f2',
        severity: 'suspend',
        comment: 'spam'
      }
    ])
  })
})

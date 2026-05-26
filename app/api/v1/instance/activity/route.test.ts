import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetDatabase = jest.fn()
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

describe('GET /api/v1/instance/activity', () => {
  beforeEach(() => {
    mockGetDatabase.mockReset()
  })

  it('returns Mastodon-shaped weekly activity from the database service', async () => {
    const getInstanceActivity = jest.fn().mockResolvedValue([
      {
        week: '1765756800',
        statuses: '12',
        logins: '4',
        registrations: '2'
      }
    ])
    mockGetDatabase.mockReturnValue({ getInstanceActivity })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/activity'),
      { params: Promise.resolve({}) }
    )

    await expect(response.json()).resolves.toEqual([
      {
        week: '1765756800',
        statuses: '12',
        logins: '4',
        registrations: '2'
      }
    ])
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(getInstanceActivity).toHaveBeenCalledTimes(1)
  })

  it('returns a JSON 500 when the database is unavailable', async () => {
    mockGetDatabase.mockReturnValue(null)

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/activity'),
      { params: Promise.resolve({}) }
    )

    await expect(response.json()).resolves.toEqual({
      status: 'Internal Server Error'
    })
    expect(response.status).toBe(500)
  })

  it('returns a JSON 500 when the activity query fails', async () => {
    const getInstanceActivity = jest
      .fn()
      .mockRejectedValue(new Error('query failed'))
    mockGetDatabase.mockReturnValue({ getInstanceActivity })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance/activity'),
      { params: Promise.resolve({}) }
    )

    await expect(response.json()).resolves.toEqual({
      status: 'Internal Server Error'
    })
    expect(response.status).toBe(500)
    expect(getInstanceActivity).toHaveBeenCalledTimes(1)
  })
})

import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCreateApplication = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

jest.mock('./createApplication', () => ({
  createApplication: (...args: unknown[]) => mockCreateApplication(...args)
}))

describe('apps route', () => {
  beforeEach(() => {
    mockCreateApplication.mockReset()
    mockCreateApplication.mockResolvedValue({
      type: 'success',
      id: 'app-id',
      client_id: 'client-id',
      client_secret: 'client-secret',
      name: 'client',
      website: null,
      redirect_uri: 'https://client.llun.dev/callback'
    })
  })

  test('does not derive registration limits from client-supplied IP headers without trusted proxy config', async () => {
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.10',
        'x-real-ip': '203.0.113.20',
        'x-forwarded-for': '198.51.100.30, 198.51.100.40'
      },
      body: JSON.stringify({
        client_name: 'client',
        redirect_uris: 'https://client.llun.dev/callback'
      })
    })

    await POST(req)

    expect(mockCreateApplication).toHaveBeenCalledWith(expect.any(Object), {
      registrationKey: undefined
    })
  })

  test('ignores raw forwarded IP chains when no trusted source exists', async () => {
    const forwardedReq = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.30, 198.51.100.40'
      },
      body: JSON.stringify({
        client_name: 'forwarded',
        redirect_uris: 'https://forwarded.llun.dev/callback'
      })
    })
    const directReq = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        client_name: 'direct',
        redirect_uris: 'https://direct.llun.dev/callback'
      })
    })

    await POST(forwardedReq)
    await POST(directReq)

    expect(mockCreateApplication).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      { registrationKey: undefined }
    )
    expect(mockCreateApplication).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      { registrationKey: undefined }
    )
  })
})

import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'

import { proxy } from './proxy'

const mockGetConfig = getConfig as jest.Mock

describe('proxy', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      host: 'public.example.com',
      allowActorDomains: []
    })
  })

  it('uses configured public host when X-Forwarded-Host would poison actor redirects', async () => {
    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'evil.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@public.example.com'
    )
  })
})

import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'

import { getRedirectUrl } from './getRedirectUrl'

const mockGetConfig = getConfig as jest.Mock

describe('#getRedirectUrl', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      host: 'example.com',
      allowActorDomains: ['public.example.com']
    })
  })

  it('returns URL with https protocol and path', () => {
    const req = new NextRequest('https://example.com/some/path', {
      headers: { Host: 'example.com' }
    })
    const result = getRedirectUrl(req, '/signin')
    expect(result).toEqual('https://example.com/signin')
  })

  it('uses X-Forwarded-Host when it is configured as a trusted local host', () => {
    const req = new NextRequest('https://internal.example.com/path', {
      headers: {
        Host: 'internal.example.com',
        'X-Forwarded-Host': 'public.example.com'
      }
    })
    const result = getRedirectUrl(req, '/callback')
    expect(result).toEqual('https://public.example.com/callback')
  })

  it('uses configured public host when X-Forwarded-Host is not trusted', () => {
    const req = new NextRequest('https://internal.example.com/path', {
      headers: {
        Host: 'internal.example.com',
        'X-Forwarded-Host': 'evil.example.com'
      }
    })
    const result = getRedirectUrl(req, '/callback')
    expect(result).toEqual('https://example.com/callback')
  })

  it('handles root path', () => {
    const req = new NextRequest('https://example.com/current', {
      headers: { Host: 'example.com' }
    })
    const result = getRedirectUrl(req, '/')
    expect(result).toEqual('https://example.com/')
  })

  it('handles nested paths', () => {
    const req = new NextRequest('https://example.com/current', {
      headers: { Host: 'example.com' }
    })
    const result = getRedirectUrl(req, '/auth/callback')
    expect(result).toEqual('https://example.com/auth/callback')
  })
})

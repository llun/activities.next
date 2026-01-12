import { NextRequest } from 'next/server'

import { getRedirectUrl } from './getRedirectUrl'

describe('#getRedirectUrl', () => {
  it('returns URL with https protocol and path', () => {
    const req = new NextRequest('https://example.com/some/path', {
      headers: { Host: 'example.com' }
    })
    const result = getRedirectUrl(req, '/signin')
    expect(result).toEqual('https://example.com/signin')
  })

  it('uses X-Forwarded-Host if available', () => {
    const req = new NextRequest('https://internal.example.com/path', {
      headers: {
        Host: 'internal.example.com',
        'X-Forwarded-Host': 'public.example.com'
      }
    })
    const result = getRedirectUrl(req, '/callback')
    expect(result).toEqual('https://public.example.com/callback')
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

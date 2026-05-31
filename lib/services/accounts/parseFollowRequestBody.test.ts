import { NextRequest } from 'next/server'

import { parseFollowRequestBody } from './parseFollowRequestBody'

describe('parseFollowRequestBody', () => {
  it('parses a JSON body with booleans and a languages array', async () => {
    const req = new NextRequest('https://llun.test/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reblogs: false,
        notify: true,
        languages: ['en', 'th']
      })
    })

    await expect(parseFollowRequestBody(req)).resolves.toEqual({
      reblogs: false,
      notify: true,
      languages: ['en', 'th']
    })
  })

  it('preserves repeated languages[] keys from a urlencoded body', async () => {
    const req = new NextRequest('https://llun.test/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'reblogs=false&notify=true&languages[]=en&languages[]=th'
    })

    await expect(parseFollowRequestBody(req)).resolves.toEqual({
      reblogs: 'false',
      notify: 'true',
      languages: ['en', 'th']
    })
  })

  it('omits fields the client did not send', async () => {
    const req = new NextRequest('https://llun.test/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify: true })
    })

    await expect(parseFollowRequestBody(req)).resolves.toEqual({
      notify: true
    })
  })

  it('returns an empty object for a bodyless request', async () => {
    const req = new NextRequest('https://llun.test/follow', { method: 'POST' })

    await expect(parseFollowRequestBody(req)).resolves.toEqual({})
  })
})

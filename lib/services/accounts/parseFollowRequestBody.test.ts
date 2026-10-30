import { NextRequest } from 'next/server'

import { parseFollowRequestBody } from './parseFollowRequestBody'

describe('parseFollowRequestBody', () => {
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

  it('keeps an explicitly empty languages[] (clear filter) from urlencoded', async () => {
    const req = new NextRequest('https://llun.test/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'languages[]='
    })

    await expect(parseFollowRequestBody(req)).resolves.toEqual({
      languages: []
    })
  })

  it('treats a well-formed non-object JSON body as empty (no throw)', async () => {
    for (const body of ['123', '"hello"', 'null', '[1,2]']) {
      const req = new NextRequest('https://llun.test/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })
      await expect(parseFollowRequestBody(req)).resolves.toEqual({})
    }
  })
})

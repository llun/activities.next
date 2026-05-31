import { NextRequest } from 'next/server'

import { parseStatusRequestBody } from './parseStatusRequestBody'

const createRequest = (contentType: string | undefined, body: string) =>
  new NextRequest('https://llun.test/api/v1/statuses', {
    method: 'POST',
    body,
    headers: contentType ? { 'content-type': contentType } : {}
  })

describe('parseStatusRequestBody', () => {
  it('parses a JSON body verbatim, preserving an explicit empty media_ids', async () => {
    const body = await parseStatusRequestBody(
      createRequest(
        'application/json',
        JSON.stringify({ status: 'hello', media_ids: [] })
      )
    )
    expect(body).toEqual({ status: 'hello', media_ids: [] })
  })

  it('returns an empty object for an empty JSON body', async () => {
    const body = await parseStatusRequestBody(
      createRequest('application/json', '')
    )
    expect(body).toEqual({})
  })

  it('reads only the fields present in a urlencoded body', async () => {
    const body = await parseStatusRequestBody(
      createRequest(
        'application/x-www-form-urlencoded',
        new URLSearchParams({
          status: 'from form',
          visibility: 'private'
        }).toString()
      )
    )
    // in_reply_to_id / spoiler_text / media_ids are absent, so they must be
    // omitted (not present-as-empty) to keep edit semantics non-destructive.
    expect(body).toEqual({ status: 'from form', visibility: 'private' })
  })

  it('collects repeated media_ids[] entries from a urlencoded body', async () => {
    const params = new URLSearchParams()
    params.append('media_ids[]', '1')
    params.append('media_ids[]', '2')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    expect(body).toEqual({ media_ids: ['1', '2'] })
  })

  it('omits media_ids when a urlencoded body sends none', async () => {
    const body = await parseStatusRequestBody(
      createRequest(
        'application/x-www-form-urlencoded',
        new URLSearchParams({ status: 'no media' }).toString()
      )
    )
    expect(body).toEqual({ status: 'no media' })
    expect('media_ids' in body).toBe(false)
  })

  it('keeps an explicit empty media_ids[] so form clients can clear media', async () => {
    const params = new URLSearchParams()
    params.append('media_ids[]', '')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    // Present-but-empty differs from absent: this must flow through as an empty
    // array (clear media), not be omitted (preserve media).
    expect(body).toEqual({ media_ids: [] })
    expect('media_ids' in body).toBe(true)
  })
})

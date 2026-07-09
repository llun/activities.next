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

  it('collects bracket-free repeated media_ids from a urlencoded body', async () => {
    const params = new URLSearchParams()
    params.append('media_ids', 'abc')
    params.append('media_ids', 'def')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    expect(body).toEqual({ media_ids: ['abc', 'def'] })
  })

  it('parses a urlencoded body when content-type carries a charset param', async () => {
    const body = await parseStatusRequestBody(
      createRequest(
        'application/x-www-form-urlencoded; charset=utf-8',
        new URLSearchParams({ status: 'charset test' }).toString()
      )
    )
    expect(body).toEqual({ status: 'charset test' })
  })

  it.each([
    ['an array', '["id1","id2"]'],
    ['null', 'null'],
    ['a string', '"status=hello"'],
    ['a number', '42']
  ])(
    'returns an empty object for a JSON body that is %s',
    async (_label, raw) => {
      const body = await parseStatusRequestBody(
        createRequest('application/json', raw)
      )
      expect(body).toEqual({})
    }
  )

  it('propagates a malformed JSON body so the caller can return 400', async () => {
    // A syntactically broken body must throw (→ caller's 400), not be swallowed
    // to {} (which would surface as a misleading 422 for missing fields).
    await expect(
      parseStatusRequestBody(
        createRequest('application/json', '{ not valid json')
      )
    ).rejects.toThrow()
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

  it('reconstructs media_attributes entries from a urlencoded body', async () => {
    const params = new URLSearchParams()
    params.append('media_attributes[][id]', '10')
    params.append('media_attributes[][description]', 'first alt')
    params.append('media_attributes[][focus]', '0.5,-0.5')
    params.append('media_attributes[][id]', '11')
    params.append('media_attributes[][description]', 'second alt')
    params.append('media_attributes[][focus]', '0,0')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    expect(body).toEqual({
      media_attributes: [
        { id: '10', description: 'first alt', focus: '0.5,-0.5' },
        { id: '11', description: 'second alt', focus: '0,0' }
      ]
    })
  })

  it('does not zip partial media_attributes fields to avoid mis-assigning them', async () => {
    // Two ids but only one description: with positional bare-[] fields this is
    // ambiguous (the description could belong to either id), so it must NOT be
    // applied to the wrong media — both entries stay id-only. Clients needing
    // per-item control should use a JSON body.
    const params = new URLSearchParams()
    params.append('media_attributes[][id]', '10')
    params.append('media_attributes[][id]', '11')
    params.append('media_attributes[][description]', 'only alt')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    expect(body).toEqual({
      media_attributes: [{ id: '10' }, { id: '11' }]
    })
  })

  it('applies aligned media_attributes fields independently (description without focus)', async () => {
    // 2 ids + 2 descriptions (aligned -> apply) but only 1 focus (ambiguous ->
    // skip): the description and focus alignment checks are independent, so the
    // aligned descriptions must still apply even though focus does not.
    const params = new URLSearchParams()
    params.append('media_attributes[][id]', '10')
    params.append('media_attributes[][description]', 'alt A')
    params.append('media_attributes[][focus]', '0,0')
    params.append('media_attributes[][id]', '11')
    params.append('media_attributes[][description]', 'alt B')
    const body = await parseStatusRequestBody(
      createRequest('application/x-www-form-urlencoded', params.toString())
    )
    expect(body).toEqual({
      media_attributes: [
        { id: '10', description: 'alt A' },
        { id: '11', description: 'alt B' }
      ]
    })
  })

  it('omits media_attributes when a urlencoded body sends none', async () => {
    const body = await parseStatusRequestBody(
      createRequest(
        'application/x-www-form-urlencoded',
        new URLSearchParams({ status: 'no media attributes' }).toString()
      )
    )
    expect(body).toEqual({ status: 'no media attributes' })
  })
})

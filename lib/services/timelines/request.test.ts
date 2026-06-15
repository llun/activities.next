import { NextRequest } from 'next/server'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { HttpMethod } from '@/lib/utils/http-headers'
import { urlToId } from '@/lib/utils/urlToId'

import { MAX_TIMELINE_LIMIT } from './getFilteredTimelinePage'
import { parseTimelineQuery, timelineErrorBoundary } from './request'

const params = (query: Record<string, string>) => new URLSearchParams(query)

const realStatusUrl = 'https://llun.test/users/alice/statuses/1'
const validCursor = urlToId(realStatusUrl)

describe('parseTimelineQuery', () => {
  it('returns ok with no params and a default limit', () => {
    const result = parseTimelineQuery(params({}))
    expect(result).toEqual({
      ok: true,
      query: {
        limit: PER_PAGE_LIMIT,
        maxStatusId: null,
        minStatusId: null,
        sinceStatusId: null
      }
    })
  })

  it('decodes valid cursors into status URLs', () => {
    const result = parseTimelineQuery(
      params({
        max_id: validCursor,
        min_id: validCursor,
        since_id: validCursor
      })
    )
    expect(result).toEqual({
      ok: true,
      query: {
        limit: PER_PAGE_LIMIT,
        maxStatusId: realStatusUrl,
        minStatusId: realStatusUrl,
        sinceStatusId: realStatusUrl
      }
    })
  })

  it('treats an empty-string cursor as absent (not a 400)', () => {
    const result = parseTimelineQuery(
      params({ max_id: '', min_id: '', since_id: '' })
    )
    expect(result).toEqual({
      ok: true,
      query: {
        limit: PER_PAGE_LIMIT,
        maxStatusId: null,
        minStatusId: null,
        sinceStatusId: null
      }
    })
  })

  // limit is clamped, never rejected (Mastodon clamps out-of-range values).
  it.each([
    { description: 'valid in-range limit', value: '5', expected: 5 },
    {
      description: 'huge limit clamps to max',
      value: '500',
      expected: MAX_TIMELINE_LIMIT
    },
    {
      description: 'negative limit falls back to default',
      value: '-5',
      expected: PER_PAGE_LIMIT
    },
    {
      description: 'non-numeric limit falls back to default',
      value: 'abc',
      expected: PER_PAGE_LIMIT
    },
    {
      description: 'zero limit falls back to default',
      value: '0',
      expected: PER_PAGE_LIMIT
    },
    {
      description: 'decimal limit is floored to an integer',
      value: '5.9',
      expected: 5
    }
  ])('clamps limit ($description)', ({ value, expected }) => {
    const result = parseTimelineQuery(params({ limit: value }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.query.limit).toBe(expected)
  })

  // Malformed cursors must fail the parse so the route returns 400, not 500.
  it.each([
    { description: 'max_id', field: 'max_id' },
    { description: 'min_id', field: 'min_id' },
    { description: 'since_id', field: 'since_id' }
  ])('rejects an undecodable $description cursor', ({ field }) => {
    expect(parseTimelineQuery(params({ [field]: 'apurl_@@@@' })).ok).toBe(false)
  })

  // A fuzz table of junk cursor values that must never 500 — undecodable ones
  // fail the parse (→ 400), well-formed-but-unknown ones pass (→ empty page).
  it.each([
    { description: 'junk opaque id', value: 'apurl_not-a-url', ok: false },
    { description: 'percent signs', value: '%%%', ok: false },
    { description: 'spaces', value: 'a b c', ok: false },
    { description: 'whitespace', value: '   ', ok: false },
    { description: 'numeric Mastodon id', value: '12345', ok: true },
    { description: 'unknown colon-form id', value: 'llun.test:x:1', ok: true }
  ])('handles fuzz cursor max_id=$description', ({ value, ok }) => {
    expect(parseTimelineQuery(params({ max_id: value })).ok).toBe(ok)
  })
})

describe('timelineErrorBoundary', () => {
  const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
  const request = () =>
    new NextRequest('https://llun.test/api/v1/timelines/public')

  it('passes through the handler response when it succeeds', async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }))
    const wrapped = timelineErrorBoundary(CORS_HEADERS, handler)

    const response = await wrapped(request(), {})
    expect(response.status).toBe(200)
  })

  it('returns a CORS-aware 500 when the handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'))
    const wrapped = timelineErrorBoundary(CORS_HEADERS, handler)

    const response = await wrapped(request(), {})
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    expect(await response.json()).toEqual({ status: 'Internal Server Error' })
  })
})

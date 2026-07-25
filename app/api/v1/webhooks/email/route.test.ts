import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { REPLY_BY_EMAIL_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { POST } from './route'

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => ({ publish: mockPublish }))
}))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockGetQueue = getQueue as jest.MockedFunction<typeof getQueue>

const SECRET = 'inbound-secret'
const INBOUND = {
  secret: SECRET,
  domain: 'reply.llun.dev',
  localPartPrefix: 'reply'
}

const payload = (overrides: Record<string, unknown> = {}) => ({
  to: ['reply+abc123@reply.llun.dev'],
  from: 'alice@example.tld',
  messageId: '<message-1@example.tld>',
  text: 'A reply',
  ...overrides
})

const sign = (body: string, seconds: number, secret = SECRET) => {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${seconds}.${body}`)
    .digest('hex')
  return `t=${seconds},v1=${signature}`
}

const request = (
  body: string,
  headers: Record<string, string> = {}
): NextRequest =>
  new NextRequest('https://llun.test/api/v1/webhooks/email', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers }
  })

const post = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/webhooks/email', () => {
  const baseConfig = mockGetConfig()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetQueue.mockReturnValue({
      publish: mockPublish
    } as unknown as ReturnType<typeof getQueue>)
    mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: INBOUND })
  })

  afterAll(() => {
    mockGetConfig.mockReturnValue(baseConfig)
  })

  const nowSeconds = () => Math.floor(Date.now() / 1000)

  it('accepts a correctly signed message and enqueues the job', async () => {
    const body = JSON.stringify(payload())
    const res = await post(
      request(body, {
        'x-activities-signature': sign(body, nowSeconds())
      })
    )

    expect(res.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: REPLY_BY_EMAIL_JOB_NAME,
        data: expect.objectContaining({
          token: 'abc123',
          from: 'alice@example.tld',
          messageId: '<message-1@example.tld>',
          text: 'A reply'
        })
      })
    )
  })

  it('finds the reply address when it only appears in cc', async () => {
    const body = JSON.stringify(
      payload({
        to: ['someone-else@example.tld'],
        cc: ['"Replies" <reply+fromcc@reply.llun.dev>']
      })
    )
    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ token: 'fromcc' })
      })
    )
  })

  it('returns 404 when inbound email is not configured', async () => {
    mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: undefined })
    const body = JSON.stringify(payload())

    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(404)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 404 when outbound email is not configured', async () => {
    mockGetConfig.mockReturnValue({
      ...baseConfig,
      email: undefined,
      emailInbound: INBOUND
    })
    const body = JSON.stringify(payload())

    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(404)
  })

  it.each([
    {
      description: 'the header is missing',
      header: undefined
    },
    {
      description: 'the header has no v1 part',
      header: 't=1'
    },
    {
      description: 'the header has no timestamp',
      header: 'v1=deadbeef'
    },
    {
      description: 'the timestamp is not a number',
      header: 't=soon,v1=deadbeef'
    }
  ])('returns 401 when $description', async ({ header }) => {
    const body = JSON.stringify(payload())
    const res = await post(
      request(body, header ? { 'x-activities-signature': header } : {})
    )

    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 401 for a signature made with the wrong secret', async () => {
    const body = JSON.stringify(payload())
    const res = await post(
      request(body, {
        'x-activities-signature': sign(body, nowSeconds(), 'not-the-secret')
      })
    )

    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 401 when the body was tampered with after signing', async () => {
    const signedBody = JSON.stringify(payload())
    const header = sign(signedBody, nowSeconds())
    const tampered = JSON.stringify(payload({ text: 'A different reply' }))

    const res = await post(
      request(tampered, { 'x-activities-signature': header })
    )

    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'too old', offset: -600 },
    { description: 'too far in the future', offset: 600 }
  ])('returns 401 for a timestamp that is $description', async ({ offset }) => {
    const body = JSON.stringify(payload())
    const res = await post(
      request(body, {
        'x-activities-signature': sign(body, nowSeconds() + offset)
      })
    )

    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    const body = 'not json at all'
    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(400)
  })

  it('returns 422 for a payload that does not match the schema', async () => {
    const body = JSON.stringify({ to: 'not-an-array' })
    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(422)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 422 when no recipient carries a reply address for this instance', async () => {
    const body = JSON.stringify(payload({ to: ['someone@example.tld'] }))
    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(422)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('returns 413 for an over-sized body', async () => {
    const body = JSON.stringify(payload({ text: 'x'.repeat(11 * 1024 * 1024) }))
    const res = await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(res.status).toBe(413)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('gives two deliveries of one message the same queue id', async () => {
    const body = JSON.stringify(payload())
    await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )
    await post(
      request(body, { 'x-activities-signature': sign(body, nowSeconds()) })
    )

    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish.mock.calls[0][0].id).toBe(
      mockPublish.mock.calls[1][0].id
    )
  })
})

import { NextRequest } from 'next/server'

import { SEND_FLAG_JOB_NAME } from '@/lib/jobs/names'
import { idToUrl } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {
  getMastodonActorFromId: vi.fn(),
  createReport: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<unknown>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<unknown> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

const createFormRequest = (body: string) =>
  new NextRequest('https://local.test/api/v1/reports', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })

const createJsonRequest = (body: unknown) =>
  new NextRequest('https://local.test/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  })

describe('POST /api/v1/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getMastodonActorFromId.mockResolvedValue({
      id: 'acc1',
      username: 'target'
    })
    mockDatabase.createReport.mockImplementation(async (input) => ({
      id: 'report-1',
      actionTaken: false,
      category: input.category ?? null,
      comment: input.comment ?? '',
      forward: input.forward,
      createdAt: Date.now(),
      statusIds: input.statusIds,
      ruleIds: input.ruleIds,
      collectionIds: input.collectionIds ?? []
    }))
  })

  it('creates a report with forward=false from a urlencoded body', async () => {
    const response = await POST(
      createFormRequest('account_id=acc1&forward=false'),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(200)
    // The string "false" must coerce to boolean false, not be truthy-coerced to true.
    expect(mockDatabase.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        targetActorId: idToUrl('acc1'),
        forward: false
      })
    )
  })

  it.each([
    ['true', true],
    ['1', true],
    ['on', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['off', false]
  ])('coerces a urlencoded forward=%s to %s', async (value, expected) => {
    const response = await POST(
      createFormRequest(`account_id=acc1&forward=${value}`),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ forward: expected })
    )
  })

  it('defaults forward to false when omitted', async () => {
    const response = await POST(createFormRequest('account_id=acc1'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ forward: false })
    )
  })

  it('parses repeated status_ids[] as an array of two, not dropped', async () => {
    const response = await POST(
      createFormRequest('account_id=acc1&status_ids[]=s1&status_ids[]=s2'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const call = mockDatabase.createReport.mock.calls[0][0]
    // Both ids survive parsing, each mapped from short form to URL form.
    expect(call.statusIds).toEqual([idToUrl('s1'), idToUrl('s2')])
  })

  it('parses multipart status_ids[] as an array of two', async () => {
    const form = new FormData()
    form.set('account_id', 'acc1')
    form.append('status_ids[]', 's1')
    form.append('status_ids[]', 's2')
    form.set('forward', 'true')

    const request = new NextRequest('https://local.test/api/v1/reports', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test-boundary'
      }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const call = mockDatabase.createReport.mock.calls[0][0]
    expect(call.statusIds).toEqual([idToUrl('s1'), idToUrl('s2')])
    expect(call.forward).toBe(true)
  })

  it('parses a JSON body with a real boolean forward and a status_ids array', async () => {
    // Exercises parseReportBody's default (req.json) branch, Booleanish's
    // z.boolean() arm (only reached by real JSON booleans), and the JSON
    // status_ids array-union arm — none of which the form paths cover.
    const response = await POST(
      createJsonRequest({
        account_id: 'acc1',
        forward: true,
        status_ids: ['s1', 's2']
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const call = mockDatabase.createReport.mock.calls[0][0]
    expect(call.forward).toBe(true)
    expect(call.statusIds).toEqual([idToUrl('s1'), idToUrl('s2')])
  })

  it('reads a real JSON boolean forward=false', async () => {
    await POST(createJsonRequest({ account_id: 'acc1', forward: false }), {
      params: Promise.resolve({})
    })

    expect(mockDatabase.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ forward: false })
    )
  })

  it('returns 404 when the target account does not exist', async () => {
    mockDatabase.getMastodonActorFromId.mockResolvedValue(null)

    const response = await POST(createFormRequest('account_id=acc1'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.createReport).not.toHaveBeenCalled()
  })

  it('persists and echoes collection_ids', async () => {
    const response = await POST(
      createJsonRequest({
        account_id: 'acc1',
        collection_ids: ['collection-1', 'collection-2']
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionIds: ['collection-1', 'collection-2']
      })
    )
    const data = await response.json()
    expect(data.collection_ids).toEqual(['collection-1', 'collection-2'])
  })

  it('parses repeated collection_ids[] from a urlencoded body', async () => {
    const response = await POST(
      createFormRequest(
        'account_id=acc1&collection_ids[]=c1&collection_ids[]=c2'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const call = mockDatabase.createReport.mock.calls[0][0]
    expect(call.collectionIds).toEqual(['c1', 'c2'])
  })

  it('federates a Flag job when forward=true', async () => {
    const response = await POST(
      createJsonRequest({
        account_id: 'acc1',
        forward: true,
        comment: 'spam',
        status_ids: ['s1']
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_FLAG_JOB_NAME,
        data: expect.objectContaining({
          reportId: 'report-1',
          targetActorId: idToUrl('acc1'),
          statusIds: [idToUrl('s1')],
          content: 'spam'
        })
      })
    )
  })

  it('does not federate a Flag job when forward=false', async () => {
    const response = await POST(
      createJsonRequest({ account_id: 'acc1', forward: false }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

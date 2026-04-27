import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCanFederateWithDomain = jest.fn()
const mockDatabase = {}
const mockPublish = jest.fn()

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

jest.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: { database: typeof mockDatabase; params: Promise<{}> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, { database: mockDatabase, params: context.params })
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const createRequest = (actor: string) =>
  new NextRequest('https://activities.local/api/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `${actor}/activities/create-1`,
      type: 'Create',
      actor,
      object: {
        id: `${actor}/statuses/1`,
        type: 'Note'
      }
    })
  })

describe('POST /api/inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects activities from blocked actor domains', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const response = await POST(createRequest('https://blocked.test/users/a'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('enqueues activities from allowed actor domains', async () => {
    mockCanFederateWithDomain.mockResolvedValue(true)

    const response = await POST(createRequest('https://allowed.test/users/a'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CreateNoteJob' })
    )
  })
})

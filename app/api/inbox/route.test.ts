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

const createRequest = (actor: unknown) => {
  const actorId =
    typeof actor === 'string' ? actor : 'https://invalid.test/users/a'

  return new NextRequest('https://activities.local/api/inbox', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      signature:
        'keyId="https://remote.test/users/a#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
    },
    body: JSON.stringify({
      id: `${actorId}/activities/create-1`,
      type: 'Create',
      actor,
      object: {
        id: `${actorId}/statuses/1`,
        type: 'Note'
      }
    })
  })
}

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

  it.each([undefined, null, '', 42, { id: 'https://invalid.test/users/a' }])(
    'rejects activities without a string actor',
    async (actor) => {
      const response = await POST(createRequest(actor), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(400)
      expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    }
  )

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

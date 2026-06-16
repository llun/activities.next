import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCanFederateWithDomain = vi.fn()
const mockGetRelayByActorId = vi.fn()
const mockDatabase = {
  getRelayByActorId: (...params: unknown[]) => mockGetRelayByActorId(...params)
}
const mockPublish = vi.fn()
const mockDefaultActivityBody = Symbol('defaultActivityBody')
let mockActivityBody: unknown = mockDefaultActivityBody
let mockConsumeRequestBody = false
let mockVerifiedSenderActorId = 'https://allowed.test/users/a'

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

vi.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          activityBody: unknown
          database: typeof mockDatabase
          params: Promise<{}>
          verifiedSenderActorId: string
        }
      ) => Promise<Response> | Response
    ) =>
    async (req: NextRequest, context: { params: Promise<{}> }) => {
      const activityBody =
        mockActivityBody === mockDefaultActivityBody
          ? await req
              .clone()
              .json()
              .catch(() => null)
          : mockActivityBody

      if (mockConsumeRequestBody) {
        await req.text().catch(() => null)
      }

      return handle(req, {
        activityBody,
        database: mockDatabase,
        params: context.params,
        verifiedSenderActorId: mockVerifiedSenderActorId
      })
    }
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const createRequest = (actor: unknown) => {
  const actorId =
    typeof actor === 'string'
      ? actor
      : typeof actor === 'object' &&
          actor !== null &&
          'id' in actor &&
          typeof actor.id === 'string'
        ? actor.id
        : 'https://invalid.test/users/a'

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
        type: 'Note',
        attributedTo: actorId
      }
    })
  })
}

describe('POST /api/inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActivityBody = mockDefaultActivityBody
    mockConsumeRequestBody = false
    mockVerifiedSenderActorId = 'https://allowed.test/users/a'
    mockGetRelayByActorId.mockResolvedValue(null)
  })

  describe('relay Announce routing', () => {
    const RELAY_ACTOR = 'https://relay.example/actor'
    const relayAnnounceBody = {
      id: `${RELAY_ACTOR}/announce/1`,
      type: 'Announce',
      actor: RELAY_ACTOR,
      published: '2024-01-01T00:00:00Z',
      object: 'https://somewhere.test/statuses/relayed',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    }

    it('routes an accepted relay Announce to the relay ingest job', async () => {
      mockCanFederateWithDomain.mockResolvedValue(true)
      mockVerifiedSenderActorId = RELAY_ACTOR
      mockActivityBody = relayAnnounceBody
      mockGetRelayByActorId.mockResolvedValue({
        id: 'relay-1',
        actorId: RELAY_ACTOR,
        state: 'accepted'
      })

      const response = await POST(createRequest(RELAY_ACTOR), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(202)
      expect(mockGetRelayByActorId).toHaveBeenCalledWith({
        actorId: RELAY_ACTOR
      })
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'RelayAnnounceJob' })
      )
    })

    it('does not route an Announce from a non-relay sender to the relay ingest job', async () => {
      mockCanFederateWithDomain.mockResolvedValue(true)
      mockVerifiedSenderActorId = RELAY_ACTOR
      mockActivityBody = relayAnnounceBody
      mockGetRelayByActorId.mockResolvedValue(null)

      const response = await POST(createRequest(RELAY_ACTOR), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CreateAnnounceJob' })
      )
    })

    it('acknowledges a known-but-not-accepted relay Announce without boosting it', async () => {
      mockCanFederateWithDomain.mockResolvedValue(true)
      mockVerifiedSenderActorId = RELAY_ACTOR
      mockActivityBody = relayAnnounceBody
      mockGetRelayByActorId.mockResolvedValue({
        id: 'relay-1',
        actorId: RELAY_ACTOR,
        state: 'pending'
      })

      const response = await POST(createRequest(RELAY_ACTOR), {
        params: Promise.resolve({})
      })

      // A known relay's Announce must never fall through to the boost path, so
      // no job (relay ingest OR CreateAnnounce) is enqueued.
      expect(response.status).toBe(202)
      expect(mockPublish).not.toHaveBeenCalled()
    })
  })

  it('rejects activities from blocked actor domains', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const response = await POST(createRequest('https://blocked.test/users/a'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it.each([undefined, null, '', 42, {}])(
    'rejects activities without a valid actor identity',
    async (actor) => {
      const response = await POST(createRequest(actor), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(400)
      expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    }
  )

  it('rejects invalid JSON without enqueueing a job', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          signature:
            'keyId="https://remote.test/users/a#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
        },
        body: '{"actor":"https://remote.test/users/a",'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('uses the verified guard activity body after the request body is consumed', async () => {
    const actor = 'https://allowed.test/users/a'
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockActivityBody = {
      id: `${actor}/activities/create-1`,
      type: 'Create',
      actor,
      object: {
        id: `${actor}/statuses/1`,
        type: 'Note',
        attributedTo: actor
      }
    }
    mockConsumeRequestBody = true

    const response = await POST(createRequest(actor), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(202)
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(mockDatabase, actor)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CreateNoteJob' })
    )
  })

  it('enqueues activities whose actor is an object with an id', async () => {
    mockCanFederateWithDomain.mockResolvedValue(true)

    const response = await POST(
      createRequest({
        id: 'https://allowed.test/users/a',
        type: 'Person'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(202)
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
      mockDatabase,
      'https://allowed.test/users/a'
    )
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CreateNoteJob' })
    )
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

  it('carries the verified sender identity into queued jobs', async () => {
    const actor = 'https://allowed.test/users/a'
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockVerifiedSenderActorId = `${actor}#main-key`
    mockActivityBody = {
      id: `${actor}/activities/create-1`,
      type: 'Create',
      actor,
      object: {
        id: `${actor}/statuses/1`,
        type: 'Note',
        attributedTo: actor
      }
    }

    const response = await POST(createRequest(actor), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'CreateNoteJob',
        verifiedSenderActorId: actor
      })
    )
  })

  it('rejects Create Note activities whose inner object actor does not match the verified sender', async () => {
    const actor = 'https://allowed.test/users/a'
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockVerifiedSenderActorId = actor
    mockActivityBody = {
      id: `${actor}/activities/create-1`,
      type: 'Create',
      actor,
      object: {
        id: `${actor}/statuses/1`,
        type: 'Note',
        actor: 'https://spoofed.test/users/mallory',
        attributedTo: actor
      }
    }

    const response = await POST(createRequest(actor), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(404)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

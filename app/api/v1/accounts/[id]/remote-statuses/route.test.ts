import { NextRequest } from 'next/server'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockDatabase = {}
const mockCurrentActor = {
  id: 'https://local.example/users/me'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (_scopes: unknown, handle: CallableFunction) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      })
}))

vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')

const actorId = 'https://remote.example/users/actor'
const pageUrl = 'https://remote.example/users/actor/outbox?page=true&max_id=1'

const createRequest = (query = '') =>
  new NextRequest(
    `https://local.example/api/v1/accounts/${urlToId(actorId)}/remote-statuses${query}`
  )

describe('GET /api/v1/accounts/[id]/remote-statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getActorPerson as jest.Mock).mockResolvedValue({
      id: actorId,
      type: 'Person',
      preferredUsername: 'actor',
      outbox: `${actorId}/outbox`
    })
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [
        {
          id: `${actorId}/statuses/older`,
          actorId,
          actor: null,
          to: [],
          cc: [],
          edits: [],
          isLocalActor: false,
          createdAt: 1,
          updatedAt: 1,
          type: StatusType.enum.Note,
          url: `${actorId}/statuses/older`,
          text: 'Older status',
          summary: null,
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          totalLikes: 0,
          attachments: [],
          tags: []
        }
      ],
      statusesCount: 30,
      nextPageUrl: null,
      prevPageUrl: `${actorId}/outbox?page=true`
    })
  })

  it('returns remote actor statuses for a requested outbox page', async () => {
    const response = await GET(
      createRequest(`?page_url=${encodeURIComponent(pageUrl)}`),
      {
        params: Promise.resolve({ id: urlToId(actorId) })
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      statuses: [{ id: `${actorId}/statuses/older` }],
      statusesCount: 30,
      nextPageUrl: null,
      prevPageUrl: `${actorId}/outbox?page=true`
    })
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId,
      signingActor: mockCurrentActor
    })
    expect(getActorPosts).toHaveBeenCalledWith({
      database: mockDatabase,
      person: expect.objectContaining({ id: actorId }),
      signingActor: mockCurrentActor,
      pageUrl
    })
  })

  it('returns bad request for invalid page urls', async () => {
    const response = await GET(createRequest('?page_url=not-a-url'), {
      params: Promise.resolve({ id: urlToId(actorId) })
    })

    expect(response.status).toBe(400)
  })

  it('returns bad request for page urls outside the actor outbox', async () => {
    const response = await GET(
      createRequest(
        `?page_url=${encodeURIComponent(
          'https://attacker.example/users/actor/outbox?page=true'
        )}`
      ),
      {
        params: Promise.resolve({ id: urlToId(actorId) })
      }
    )

    expect(response.status).toBe(400)
    expect(getActorPosts).not.toHaveBeenCalled()
  })
})

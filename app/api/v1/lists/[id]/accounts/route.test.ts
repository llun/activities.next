import { NextRequest } from 'next/server'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { generatePublicId, getClientActorId } from '@/lib/utils/publicId'
import { idToUrl } from '@/lib/utils/urlToId'

import { DELETE, GET, MAX_LIST_ACCOUNT_IDS, POST } from './route'

const mockDatabase = {
  getList: vi.fn(),
  getListAccounts: vi.fn(),
  addListAccounts: vi.fn(),
  removeListAccounts: vi.fn(),
  getAcceptedOrRequestedFollowTargetActorIds: vi.fn(),
  getActorsFromIds: vi.fn(),
  getActorIdsByPublicIds: vi.fn()
}

const overCapAccountIds = () =>
  Array.from({ length: MAX_LIST_ACCOUNT_IDS + 1 }, (_, index) => `acc${index}`)
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}

// What the bypassed guard hands the route: these mocks, unless the suite that
// runs against a real database swaps in that database and one of its actors.
let mockRouteContext: {
  database: unknown
  currentActor: { id: string; domain: string }
} = { database: mockDatabase, currentActor: mockCurrentActor }

vi.mock('@/lib/services/guards/OAuthGuard', () => {
  const bypass =
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: typeof mockRouteContext & {
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, { ...mockRouteContext, params: context.params })
  return {
    OAuthGuard: bypass,
    OAuthGuardAnyScope: bypass
  }
})

const LIST_ID = 'list-1'
const URL_BASE = `https://local.test/api/v1/lists/${LIST_ID}/accounts`

const params = () => ({ params: Promise.resolve({ id: LIST_ID }) })

const jsonPost = (accountIds: string[]) =>
  new NextRequest(URL_BASE, {
    method: 'POST',
    body: JSON.stringify({ account_ids: accountIds }),
    headers: { 'content-type': 'application/json' }
  })

describe('GET /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.getListAccounts.mockResolvedValue({
      accounts: [],
      nextMaxId: null,
      prevMinId: null
    })
  })

  it('defaults the page size to 40', async () => {
    const request = new NextRequest(URL_BASE)
    const response = await GET(request, params())
    expect(response.status).toBe(200)
    expect(mockDatabase.getListAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 40 })
    )
  })

  it.each([
    { field: 'min_id' as const, slot: 'minId', other: 'sinceId' },
    { field: 'since_id' as const, slot: 'sinceId', other: 'minId' }
  ])(
    'routes $field alone to $slot without collapsing into $other',
    async ({ field, slot, other }) => {
      const request = new NextRequest(`${URL_BASE}?${field}=cursor-x`)
      const response = await GET(request, params())
      expect(response.status).toBe(200)
      const call = mockDatabase.getListAccounts.mock.calls[0][0] as Record<
        string,
        unknown
      >
      expect(call[slot]).toBe('cursor-x')
      // The absent cursor is passed as null (query default), never collapsed
      // into the other slot — so min_id gets adjacent-page and since_id gets
      // newest-slice semantics.
      expect(call[other]).toBeNull()
    }
  )

  it('returns all members without pagination when limit=0', async () => {
    mockDatabase.getListAccounts.mockResolvedValue({
      accounts: [{ id: 'a1' }, { id: 'a2' }],
      nextMaxId: 'row-2',
      prevMinId: 'row-1'
    })
    const request = new NextRequest(`${URL_BASE}?limit=0`)
    const response = await GET(request, params())
    expect(response.status).toBe(200)
    expect(mockDatabase.getListAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 0 })
    )
    expect(response.headers.get('Link')).toBeNull()
    expect(await response.json()).toHaveLength(2)
  })
})

describe('POST /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps queued mockResolvedValueOnce values and
    // implementations; reset the lookups so no test inherits another's.
    mockDatabase.getActorIdsByPublicIds.mockReset()
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockReset()
    mockDatabase.getActorsFromIds.mockReset()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.addListAccounts.mockResolvedValue(undefined)
    mockDatabase.removeListAccounts.mockResolvedValue(undefined)
    // Unless a test says otherwise, the owner follows or has requested to
    // follow every account named.
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockImplementation(
      async ({ targetActorIds }: { targetActorIds: string[] }) => targetActorIds
    )
    mockDatabase.getActorsFromIds.mockResolvedValue([])
  })

  it.each([
    {
      description:
        'answers 422 for an account the owner neither follows nor has requested to follow',
      storedActorIds: [idToUrl('acc1')],
      status: 422,
      body: { error: 'Validation failed: Account must be a followed account' }
    },
    {
      description: 'answers 404 for an id that names no account',
      storedActorIds: [],
      status: 404,
      body: { error: 'Not Found' }
    }
  ])('$description', async ({ storedActorIds, status, body }) => {
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockResolvedValue(
      []
    )
    mockDatabase.getActorsFromIds.mockResolvedValue(
      storedActorIds.map((id) => ({ id }))
    )

    const response = await POST(jsonPost(['acc1']), params())

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it('answers 404 when an unknown id comes with an account the owner does not follow', async () => {
    // Mastodon looks every account up before it validates any membership.
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockResolvedValue(
      []
    )
    mockDatabase.getActorsFromIds.mockResolvedValue([{ id: idToUrl('acc1') }])

    const response = await POST(jsonPost(['acc1', 'acc2']), params())

    expect(response.status).toBe(404)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it('checks every account but the owner in one relationship query', async () => {
    const ownPublicId = generatePublicId()
    mockDatabase.getActorIdsByPublicIds.mockResolvedValueOnce(
      new Map([[ownPublicId, mockCurrentActor.id]])
    )

    const response = await POST(
      jsonPost(['acc1', ownPublicId, 'acc2', 'acc1']),
      params()
    )

    expect(response.status).toBe(200)
    expect(
      mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mock.calls
    ).toEqual([
      [
        {
          actorId: mockCurrentActor.id,
          targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
        }
      ]
    ])
    // An account with a follow or a request behind it needs no lookup.
    expect(mockDatabase.getActorsFromIds).not.toHaveBeenCalled()
  })

  it('lets the list owner add themselves without following themselves', async () => {
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockResolvedValue(
      []
    )
    const ownPublicId = generatePublicId()
    mockDatabase.getActorIdsByPublicIds.mockResolvedValueOnce(
      new Map([[ownPublicId, mockCurrentActor.id]])
    )
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: [ownPublicId] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [mockCurrentActor.id]
    })
  })

  it.each([
    {
      description: 'adds the owner alongside a followed account in one request',
      relatedActorIds: [idToUrl('acc1')],
      status: 200,
      addCalls: [
        [
          {
            listId: LIST_ID,
            actorId: mockCurrentActor.id,
            targetActorIds: [mockCurrentActor.id, idToUrl('acc1')]
          }
        ]
      ]
    },
    {
      description:
        'still requires a follow or a request for anyone the owner adds alongside themselves',
      relatedActorIds: [],
      status: 422,
      addCalls: []
    }
  ])('$description', async ({ relatedActorIds, status, addCalls }) => {
    mockDatabase.getAcceptedOrRequestedFollowTargetActorIds.mockResolvedValue(
      relatedActorIds
    )
    mockDatabase.getActorsFromIds.mockResolvedValue([{ id: idToUrl('acc1') }])
    const ownPublicId = generatePublicId()
    mockDatabase.getActorIdsByPublicIds.mockResolvedValueOnce(
      new Map([[ownPublicId, mockCurrentActor.id]])
    )
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: [ownPublicId, 'acc1'] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(status)
    expect(mockDatabase.addListAccounts.mock.calls).toEqual(addCalls)
  })

  it('adds accounts from a urlencoded bracket-array body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: 'account_ids[]=acc1&account_ids[]=acc2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('adds accounts from a multipart bracket-array body', async () => {
    const form = new FormData()
    form.append('account_ids[]', 'acc1')
    form.append('account_ids[]', 'acc2')
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('adds accounts from a JSON body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ account_ids: ['acc1', 'acc2'] }),
      headers: { 'content-type': 'application/json' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.addListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('returns 404 when the list does not exist', async () => {
    mockDatabase.getList.mockResolvedValue(null)
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: 'account_ids[]=acc1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(404)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it('returns 422 when no account ids are supplied', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'POST',
      body: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await POST(request, params())

    expect(response.status).toBe(422)
    expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'a JSON body',
      body: JSON.stringify({
        account_ids: overCapAccountIds()
      }),
      contentType: 'application/json'
    },
    {
      description: 'a urlencoded bracket-array body',
      body: overCapAccountIds()
        .map((accountId) => `account_ids[]=${accountId}`)
        .join('&'),
      contentType: 'application/x-www-form-urlencoded'
    }
  ])(
    'returns 422 for an over-cap account_ids list in $description',
    async ({ body, contentType }) => {
      const request = new NextRequest(URL_BASE, {
        method: 'POST',
        body,
        headers: { 'content-type': contentType }
      })

      const response = await POST(request, params())

      expect(response.status).toBe(422)
      expect(mockDatabase.addListAccounts).not.toHaveBeenCalled()
      expect(mockDatabase.getActorIdsByPublicIds).not.toHaveBeenCalled()
    }
  )
})

describe('DELETE /api/v1/lists/:id/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorIdsByPublicIds.mockReset()
    mockDatabase.getList.mockResolvedValue({ id: LIST_ID, title: 'Friends' })
    mockDatabase.addListAccounts.mockResolvedValue(undefined)
    mockDatabase.removeListAccounts.mockResolvedValue(undefined)
  })

  it('removes accounts read from the query string only (masto.js DELETE)', async () => {
    const request = new NextRequest(
      `${URL_BASE}?account_ids[]=acc1&account_ids[]=acc2`,
      { method: 'DELETE' }
    )

    const response = await DELETE(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.removeListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('removes accounts from a urlencoded body', async () => {
    const request = new NextRequest(URL_BASE, {
      method: 'DELETE',
      body: 'account_ids[]=acc1&account_ids[]=acc2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    const response = await DELETE(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.removeListAccounts).toHaveBeenCalledWith({
      listId: LIST_ID,
      actorId: mockCurrentActor.id,
      targetActorIds: [idToUrl('acc1'), idToUrl('acc2')]
    })
  })

  it('returns 422 when no account ids are supplied', async () => {
    const request = new NextRequest(URL_BASE, { method: 'DELETE' })

    const response = await DELETE(request, params())

    expect(response.status).toBe(422)
    expect(mockDatabase.removeListAccounts).not.toHaveBeenCalled()
  })

  it('resolves a whole batch of publicIds with a single database lookup', async () => {
    mockDatabase.getActorIdsByPublicIds.mockResolvedValue(
      new Map<string, string>()
    )
    const publicIds = Array.from({ length: 20 }, () => generatePublicId())
    const request = new NextRequest(
      `${URL_BASE}?${publicIds
        .map((publicId) => `account_ids[]=${publicId}`)
        .join('&')}`,
      { method: 'DELETE' }
    )

    const response = await DELETE(request, params())

    expect(response.status).toBe(200)
    expect(mockDatabase.getActorIdsByPublicIds).toHaveBeenCalledTimes(1)
    expect(mockDatabase.getActorIdsByPublicIds).toHaveBeenCalledWith({
      publicIds
    })
  })

  it('returns 422 for an over-cap account_ids query list', async () => {
    const request = new NextRequest(
      `${URL_BASE}?${overCapAccountIds()
        .map((accountId) => `account_ids[]=${accountId}`)
        .join('&')}`,
      { method: 'DELETE' }
    )

    const response = await DELETE(request, params())

    expect(response.status).toBe(422)
    expect(mockDatabase.removeListAccounts).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/lists/:id/accounts against the database', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterEach(() => {
    mockRouteContext = {
      database: mockDatabase,
      currentActor: mockCurrentActor
    }
  })

  afterAll(async () => {
    await Promise.all(table.map(([, database]) => database.destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const localActor = async (username: string) => {
      await database.createAccount({
        email: `${username}@${TEST_DOMAIN}`,
        username,
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: `privateKey-${username}`,
        publicKey: `publicKey-${username}`
      })
      const actor = await database.getActorFromUsername({
        username,
        domain: TEST_DOMAIN
      })
      if (!actor) throw new Error(`${username} not created`)
      return actor
    }

    // Posts to a fresh list of the owner's the way a client would, then reads
    // back who is on it.
    const addToNewList = async (
      owner: { id: string; domain: string },
      accountId: string
    ) => {
      const list = await database.createList({
        actorId: owner.id,
        title: 'Route'
      })
      mockRouteContext = { database, currentActor: owner }
      const response = await POST(
        new NextRequest(
          `https://${TEST_DOMAIN}/api/v1/lists/${list.id}/accounts`,
          {
            method: 'POST',
            body: JSON.stringify({ account_ids: [accountId] }),
            headers: { 'content-type': 'application/json' }
          }
        ),
        { params: Promise.resolve({ id: list.id }) }
      )
      const { accounts } = await database.getListAccounts({
        listId: list.id,
        actorId: owner.id
      })
      return {
        status: response.status,
        members: accounts.map((account) => account.username)
      }
    }

    it.each([
      {
        description: 'adds an account the owner has only requested to follow',
        key: 'requested',
        statuses: [FollowStatus.enum.Requested],
        status: 200,
        listed: true
      },
      {
        description: 'adds an account the owner follows',
        key: 'accepted',
        statuses: [FollowStatus.enum.Accepted],
        status: 200,
        listed: true
      },
      {
        description: 'refuses an account whose follow request was withdrawn',
        key: 'withdrawn',
        statuses: [FollowStatus.enum.Requested, FollowStatus.enum.Undo],
        status: 422,
        listed: false
      },
      {
        description: 'refuses an account whose follow request was rejected',
        key: 'rejected',
        statuses: [FollowStatus.enum.Requested, FollowStatus.enum.Rejected],
        status: 422,
        listed: false
      },
      {
        description: 'refuses an account the owner never asked to follow',
        key: 'unrelated',
        statuses: [],
        status: 422,
        listed: false
      }
    ])('$description', async ({ key, statuses, status, listed }) => {
      const owner = await localActor(`route-${key}-owner`)
      const account = await localActor(`route-${key}-account`)
      const [createdAs, ...transitions] = statuses
      if (createdAs) {
        const follow = await database.createFollow({
          actorId: owner.id,
          targetActorId: account.id,
          status: createdAs,
          inbox: `${account.id}/inbox`,
          sharedInbox: `${account.id}/inbox`
        })
        for (const next of transitions) {
          await database.updateFollowStatus({
            followId: follow.id,
            status: next
          })
        }
      }

      const result = await addToNewList(owner, getClientActorId(account))

      expect(result).toEqual({
        status,
        members: listed ? [account.username] : []
      })
    })

    it('answers 404 for an id that names no account', async () => {
      const owner = await localActor('route-unknown-owner')

      expect(await addToNewList(owner, generatePublicId())).toEqual({
        status: 404,
        members: []
      })
    })
  })
})

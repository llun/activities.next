import { NextRequest } from 'next/server'

import {
  changeHostedBlueskyHandle,
  createHostedBlueskyAccount,
  deactivateHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  getHostedBlueskyAccountState,
  reactivateHostedBlueskyAccount,
  setHostedBlueskyRecoveryKey
} from '@/lib/services/pds/accounts'
import {
  PdsHostedAccountExistsError,
  PdsNotAllowedError,
  PdsRotationKeyMissingError
} from '@/lib/services/pds/errors'
import { PlcDirectoryError } from '@/lib/services/pds/plc'
import type { HostedBlueskyAccountState } from '@/lib/utils/blueskyHosted'

import { DELETE, GET, PATCH, POST } from './route'

const currentActor = { id: 'actor-a', domain: 'social.example' }
const database = {}
const guardCalls: string[] = []

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (handle: (req: NextRequest, context: unknown) => unknown) =>
    (req: NextRequest, context: object) => {
      guardCalls.push('session')
      return handle(req, { ...context, currentActor, database })
    }
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConfig: () => ({ host: 'social.example' })
}))
vi.mock('@/lib/services/pds/accounts', () => ({
  getHostedBlueskyAccountState: vi.fn(),
  createHostedBlueskyAccount: vi.fn(),
  deactivateHostedBlueskyAccount: vi.fn(),
  reactivateHostedBlueskyAccount: vi.fn(),
  changeHostedBlueskyHandle: vi.fn(),
  setHostedBlueskyRecoveryKey: vi.fn(),
  deleteHostedBlueskyAccount: vi.fn()
}))

const state: HostedBlueskyAccountState = {
  available: true,
  pdsHostname: 'pds.social.example',
  rotationKeyConfigured: true,
  repo: null,
  handleChoices: [{ handle: 'alice.pds.social.example', kind: 'pds' }],
  customHandleAllowed: false
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
  const handler = { GET, POST, PATCH, DELETE }[method]
  return handler(
    new NextRequest('https://social.example/api/v1/bluesky/hosted', {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }),
    { params: Promise.resolve({}) }
  )
}

describe('/api/v1/bluesky/hosted', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    guardCalls.length = 0
    vi.mocked(getHostedBlueskyAccountState).mockResolvedValue(state)
  })

  it('GET answers the card state', async () => {
    const response = await call('GET')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(state)
    expect(getHostedBlueskyAccountState).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })
    expect(guardCalls).toEqual(['session'])
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'POST'
    )
  })

  it('POST creates an account with the chosen handle', async () => {
    vi.mocked(createHostedBlueskyAccount).mockResolvedValue(state)

    const response = await call('POST', {
      handle: 'alice.pds.social.example'
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(state)
    expect(createHostedBlueskyAccount).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      handle: 'alice.pds.social.example'
    })
  })

  it('POST refuses a body without a handle', async () => {
    const response = await call('POST', {})

    expect(response.status).toBe(400)
    expect(createHostedBlueskyAccount).not.toHaveBeenCalled()
  })

  it('PATCH turns the account off and on', async () => {
    vi.mocked(deactivateHostedBlueskyAccount).mockResolvedValue(state)
    vi.mocked(reactivateHostedBlueskyAccount).mockResolvedValue(state)

    await call('PATCH', { active: false })
    expect(deactivateHostedBlueskyAccount).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })

    await call('PATCH', { active: true })
    expect(reactivateHostedBlueskyAccount).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })
  })

  it('PATCH changes the handle and the recovery key', async () => {
    vi.mocked(changeHostedBlueskyHandle).mockResolvedValue(state)
    vi.mocked(setHostedBlueskyRecoveryKey).mockResolvedValue(state)

    await call('PATCH', { handle: 'alice.example.com' })
    expect(changeHostedBlueskyHandle).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      handle: 'alice.example.com'
    })

    await call('PATCH', { recoveryKeyDid: 'did:key:zRecovery' })
    expect(setHostedBlueskyRecoveryKey).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      recoveryKeyDid: 'did:key:zRecovery'
    })

    await call('PATCH', { recoveryKeyDid: null })
    expect(setHostedBlueskyRecoveryKey).toHaveBeenLastCalledWith({
      database,
      actor: currentActor,
      recoveryKeyDid: null
    })
  })

  it('PATCH with no known field is a no-op that answers the state', async () => {
    const response = await call('PATCH', { unknown: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(state)
    expect(changeHostedBlueskyHandle).not.toHaveBeenCalled()
    expect(setHostedBlueskyRecoveryKey).not.toHaveBeenCalled()
    expect(deactivateHostedBlueskyAccount).not.toHaveBeenCalled()
    expect(reactivateHostedBlueskyAccount).not.toHaveBeenCalled()
  })

  it('DELETE deletes with the confirmed handle', async () => {
    vi.mocked(deleteHostedBlueskyAccount).mockResolvedValue(state)

    const response = await call('DELETE', {
      confirmHandle: 'alice.pds.social.example'
    })

    expect(response.status).toBe(200)
    expect(deleteHostedBlueskyAccount).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      confirmHandle: 'alice.pds.social.example'
    })
  })

  it('DELETE refuses a body without a confirmed handle', async () => {
    const response = await call('DELETE', {})

    expect(response.status).toBe(400)
    expect(deleteHostedBlueskyAccount).not.toHaveBeenCalled()
  })

  it('maps typed errors to their statuses', async () => {
    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new PdsNotAllowedError('actor-a')
    )
    expect(
      (await call('POST', { handle: 'alice.pds.social.example' })).status
    ).toBe(403)

    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new PdsHostedAccountExistsError()
    )
    expect(
      (await call('POST', { handle: 'alice.pds.social.example' })).status
    ).toBe(409)

    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new PdsRotationKeyMissingError()
    )
    const missingKey = await call('POST', {
      handle: 'alice.pds.social.example'
    })
    expect(missingKey.status).toBe(422)
    expect(await missingKey.json()).toMatchObject({ error: expect.any(String) })
  })

  it('answers 502 when the PLC directory fails', async () => {
    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new PlcDirectoryError('PLC directory refused operation', 500)
    )

    const response = await call('POST', {
      handle: 'alice.pds.social.example'
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })
})

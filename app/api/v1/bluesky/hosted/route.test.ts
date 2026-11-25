import { NextRequest } from 'next/server'

import { comparePassword } from '@/lib/services/auth/passwordHash'
import { checkPasswordChangeRateLimit } from '@/lib/services/auth/routeRateLimits'
import { sendMail } from '@/lib/services/email'
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
  PdsHostedRateLimitedError,
  PdsNotAllowedError,
  PdsRotationKeyMissingError,
  PdsValidationError
} from '@/lib/services/pds/errors'
import { PlcDirectoryError } from '@/lib/services/pds/plc'
import type { HostedBlueskyAccountState } from '@/lib/utils/blueskyHosted'

import { DELETE, GET, PATCH, POST } from './route'

const currentActor: {
  id: string
  domain: string
  account: { id: string; email: string; passwordHash: string | null }
} = {
  id: 'actor-a',
  domain: 'social.example',
  account: {
    id: 'account-a',
    email: 'alice@social.example',
    passwordHash: 'stored-hash'
  }
}
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
  getConfig: () => ({ host: 'social.example' }),
  getBaseURL: () => 'https://social.example'
}))
vi.mock('@/lib/services/auth/passwordHash', () => ({
  comparePassword: vi.fn()
}))
vi.mock('@/lib/services/auth/routeRateLimits', () => ({
  checkPasswordChangeRateLimit: vi.fn()
}))
vi.mock('@/lib/services/email', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/services/email/sender', () => ({
  resolveEmailIdentity: async () => ({
    brand: { name: 'Social', domain: 'social.example' },
    from: 'noreply@social.example',
    contactEmail: ''
  })
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
  pdsEnabled: true,
  pdsHostname: 'pds.social.example',
  rotationKeyConfigured: true,
  repo: null,
  handleChoices: [{ handle: 'alice.pds.social.example', kind: 'pds' }],
  customHandleAllowed: false,
  movedTo: null,
  moveOut: null
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
    vi.mocked(checkPasswordChangeRateLimit).mockResolvedValue({ allowed: true })
    vi.mocked(comparePassword).mockImplementation(
      async (password) => password === 'right-password'
    )
    currentActor.account.passwordHash = 'stored-hash'
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

    await call('PATCH', {
      recoveryKeyDid: 'did:key:zRecovery',
      currentPassword: 'right-password'
    })
    expect(setHostedBlueskyRecoveryKey).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      recoveryKeyDid: 'did:key:zRecovery'
    })

    await call('PATCH', {
      recoveryKeyDid: null,
      currentPassword: 'right-password'
    })
    expect(setHostedBlueskyRecoveryKey).toHaveBeenLastCalledWith({
      database,
      actor: currentActor,
      recoveryKeyDid: null
    })
  })

  it.each([
    ['missing', undefined, 'Current password is required'],
    ['wrong', 'wrong-password', 'Current password is incorrect']
  ])(
    'PATCH refuses a recovery key change with a %s password',
    async (_label, currentPassword, error) => {
      for (const recoveryKeyDid of ['did:key:zRecovery', null]) {
        const response = await call('PATCH', {
          recoveryKeyDid,
          ...(currentPassword ? { currentPassword } : {})
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error })
      }
      expect(setHostedBlueskyRecoveryKey).not.toHaveBeenCalled()
      expect(sendMail).not.toHaveBeenCalled()
    }
  )

  it('PATCH asks an account without a password to set one first', async () => {
    currentActor.account.passwordHash = null

    const response = await call('PATCH', {
      recoveryKeyDid: null,
      currentPassword: 'anything'
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error:
        'Set a password before changing your recovery key. Use "Forgot password" to set one; the link is sent to your email address.'
    })
    expect(setHostedBlueskyRecoveryKey).not.toHaveBeenCalled()
  })

  it('PATCH emails the owner after a recovery key change', async () => {
    vi.mocked(setHostedBlueskyRecoveryKey).mockResolvedValue({
      ...state,
      repo: {
        did: 'did:plc:abc123',
        handle: 'alice.pds.social.example',
        status: 'active',
        recoveryKeyDid: 'did:key:zRecovery'
      }
    })

    const response = await call('PATCH', {
      recoveryKeyDid: 'did:key:zRecovery',
      currentPassword: 'right-password'
    })

    expect(response.status).toBe(200)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [message] = vi.mocked(sendMail).mock.calls[0]
    expect(message.to).toEqual(['alice@social.example'])
    expect(message.subject).toBe(
      'A recovery key was added to your Bluesky account'
    )
    expect(message.content.text).toContain('did:key:zRecovery')
  })

  it('PATCH still succeeds when the recovery key notice fails to send', async () => {
    vi.mocked(setHostedBlueskyRecoveryKey).mockResolvedValue({
      ...state,
      repo: {
        did: 'did:plc:abc123',
        handle: 'alice.pds.social.example',
        status: 'active',
        recoveryKeyDid: null
      }
    })
    vi.mocked(sendMail).mockRejectedValue(new Error('smtp down'))

    const response = await call('PATCH', {
      recoveryKeyDid: null,
      currentPassword: 'right-password'
    })

    expect(response.status).toBe(200)
  })

  it('maps a hosted-account rate limit to 429 with a plain message', async () => {
    vi.mocked(changeHostedBlueskyHandle).mockRejectedValue(
      new PdsHostedRateLimitedError()
    )

    const response = await call('PATCH', { handle: 'alice.example.com' })

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: 'Too many tries. Try again later.'
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

  it('answers an invalid handle as 422, as on origin/main', async () => {
    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new PdsValidationError('Enter a valid handle, like alice.example.com.')
    )

    const response = await call('POST', { handle: 'not a handle' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: 'Enter a valid handle, like alice.example.com.'
    })
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

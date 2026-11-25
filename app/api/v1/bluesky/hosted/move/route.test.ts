import { NextRequest } from 'next/server'

import { comparePassword } from '@/lib/services/auth/passwordHash'
import { checkPasswordChangeRateLimit } from '@/lib/services/auth/routeRateLimits'
import { getHostedBlueskyAccountState } from '@/lib/services/pds/accounts'
import {
  PdsAccountMovedError,
  PdsHostedRateLimitedError,
  PdsMoveOutInProgressError,
  PdsMoveOutInvalidCredentialsError,
  PdsMoveOutInvalidServerUrlError,
  PdsMoveOutNotFoundError,
  PdsMoveOutRemoteError,
  PdsMoveOutSwitchedError
} from '@/lib/services/pds/errors'
import {
  cancelMoveOut,
  copyMoveOutBlobs,
  copyMoveOutPreferences,
  finishMoveOut,
  getMoveOutProgress,
  sendMoveOutRepo,
  startMoveOut
} from '@/lib/services/pds/moveOut'
import { PlcDirectoryError } from '@/lib/services/pds/plc'
import type { HostedBlueskyAccountState } from '@/lib/utils/blueskyHosted'

import { DELETE, GET, POST } from './route'

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
vi.mock('@/lib/services/pds/accounts', () => ({
  getHostedBlueskyAccountState: vi.fn()
}))
vi.mock('@/lib/services/pds/moveOut', () => ({
  startMoveOut: vi.fn(),
  sendMoveOutRepo: vi.fn(),
  copyMoveOutBlobs: vi.fn(),
  copyMoveOutPreferences: vi.fn(),
  getMoveOutProgress: vi.fn(),
  finishMoveOut: vi.fn(),
  cancelMoveOut: vi.fn()
}))

const state: HostedBlueskyAccountState = {
  available: true,
  pdsHostname: 'pds.social.example',
  rotationKeyConfigured: true,
  repo: {
    did: 'did:plc:abc123',
    handle: 'alice.pds.social.example',
    status: 'active',
    recoveryKeyDid: null
  },
  handleChoices: [{ handle: 'alice.pds.social.example', kind: 'pds' }],
  customHandleAllowed: true,
  movedTo: null,
  moveOut: null
}

const call = (method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
  const handler = { GET, POST, DELETE }[method]
  return handler(
    new NextRequest('https://social.example/api/v1/bluesky/hosted/move', {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }),
    { params: Promise.resolve({}) }
  )
}

describe('/api/v1/bluesky/hosted/move', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    guardCalls.length = 0
    vi.mocked(getHostedBlueskyAccountState).mockResolvedValue(state)
    vi.mocked(getMoveOutProgress).mockResolvedValue(null)
    vi.mocked(checkPasswordChangeRateLimit).mockResolvedValue({ allowed: true })
    vi.mocked(comparePassword).mockImplementation(
      async (password) => password === 'right-password'
    )
    currentActor.account.passwordHash = 'stored-hash'
  })

  it('GET returns progress and state under AuthenticatedGuard', async () => {
    const progress = {
      pdsUrl: 'https://dest.pds.example',
      handle: 'alice.dest.pds.example',
      stage: 'started' as const,
      importedRev: '3krev',
      localRev: '3krev',
      switchedAt: null,
      status: {
        activated: false,
        validDid: false,
        repoCommit: 'bafycommit',
        repoRev: '3krev',
        repoBlocks: 5,
        indexedRecords: 2,
        privateStateValues: 0,
        expectedBlobs: 1,
        importedBlobs: 1
      }
    }
    vi.mocked(getMoveOutProgress).mockResolvedValue(progress)

    const response = await call('GET')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ progress, state })
    expect(guardCalls).toEqual(['session'])
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'POST'
    )
  })

  it('POST dispatches start, repo, blobs, preferences, and finish steps', async () => {
    vi.mocked(startMoveOut).mockResolvedValue({
      moveOut: {
        pdsUrl: 'https://dest.pds.example',
        handle: 'alice.dest.pds.example',
        stage: 'started'
      },
      state
    })
    vi.mocked(sendMoveOutRepo).mockResolvedValue({
      importedRev: '3krev',
      bytes: 256
    })
    vi.mocked(copyMoveOutBlobs).mockResolvedValue({
      copied: 2,
      failed: [],
      cursor: 'c2',
      done: false
    })
    vi.mocked(copyMoveOutPreferences).mockResolvedValue({ count: 1 })
    vi.mocked(finishMoveOut).mockResolvedValue({
      movedTo: 'dest.pds.example',
      handle: 'alice.dest.pds.example',
      missingBlobs: 0,
      state: { ...state, movedTo: 'dest.pds.example' }
    })

    const startRes = await call('POST', {
      step: 'start',
      pdsUrl: 'https://dest.pds.example',
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'new-password',
      inviteCode: 'code-1',
      currentPassword: 'right-password'
    })
    expect(startRes.status).toBe(200)
    expect(startMoveOut).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      pdsUrl: 'https://dest.pds.example',
      handle: 'alice.dest.pds.example',
      email: 'alice@example.com',
      password: 'new-password',
      inviteCode: 'code-1'
    })

    const repoRes = await call('POST', { step: 'repo' })
    expect(repoRes.status).toBe(200)
    expect(sendMoveOutRepo).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })

    const blobsRes = await call('POST', {
      step: 'blobs',
      cursor: 'c1',
      limit: 10
    })
    expect(blobsRes.status).toBe(200)
    expect(copyMoveOutBlobs).toHaveBeenCalledWith({
      database,
      actor: currentActor,
      cursor: 'c1',
      limit: 10
    })

    const prefsRes = await call('POST', { step: 'preferences' })
    expect(prefsRes.status).toBe(200)
    expect(copyMoveOutPreferences).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })

    const finishRes = await call('POST', {
      step: 'finish',
      currentPassword: 'right-password'
    })
    expect(finishRes.status).toBe(200)
    expect(finishMoveOut).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })
  })

  it('POST refuses invalid bodies with 400', async () => {
    for (const body of [
      {},
      { step: 'unknown' },
      { step: 'start', pdsUrl: 'https://dest.pds.example' },
      { step: 'blobs', limit: 0 }
    ]) {
      const response = await call('POST', body)
      expect(response.status).toBe(400)
    }
    expect(startMoveOut).not.toHaveBeenCalled()
    expect(finishMoveOut).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined, 'Current password is required'],
    ['empty', '', 'Current password is required'],
    ['wrong', 'wrong-password', 'Current password is incorrect']
  ])(
    'POST finish refuses %s current password with 403 and does not call finishMoveOut',
    async (_label, currentPassword, error) => {
      const response = await call('POST', {
        step: 'finish',
        ...(currentPassword !== undefined ? { currentPassword } : {})
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error })
      expect(finishMoveOut).not.toHaveBeenCalled()
    }
  )

  it('POST finish refuses an account without a password set', async () => {
    currentActor.account.passwordHash = null
    const response = await call('POST', {
      step: 'finish',
      currentPassword: 'anything'
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error:
        'Set a password before moving your Bluesky account. Use "Forgot password" to set one; the link is sent to your email address.'
    })
    expect(finishMoveOut).not.toHaveBeenCalled()
  })

  it('POST finish returns 429 when password checks are rate limited', async () => {
    vi.mocked(checkPasswordChangeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60
    })
    const response = await call('POST', {
      step: 'finish',
      currentPassword: 'right-password'
    })
    expect(response.status).toBe(429)
    expect(finishMoveOut).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined, 'Current password is required'],
    ['wrong', 'wrong-password', 'Current password is incorrect']
  ])(
    'POST start refuses %s current password with 403 and does not call startMoveOut',
    async (_label, currentPassword, error) => {
      const response = await call('POST', {
        step: 'start',
        pdsUrl: 'https://dest.pds.example',
        handle: 'alice.dest.pds.example',
        email: 'alice@example.com',
        password: 'new-password',
        ...(currentPassword !== undefined ? { currentPassword } : {})
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error })
      expect(startMoveOut).not.toHaveBeenCalled()
    }
  )

  it('DELETE cancels the move', async () => {
    vi.mocked(cancelMoveOut).mockResolvedValue({
      cancelled: true,
      pdsUrl: 'https://dest.pds.example',
      handle: 'alice.dest.pds.example',
      remoteAccountRemains: true,
      message: 'Move cancelled.',
      state
    })
    const response = await call('DELETE')
    expect(response.status).toBe(200)
    expect(cancelMoveOut).toHaveBeenCalledWith({
      database,
      actor: currentActor
    })
  })

  it.each([
    [new PdsMoveOutInvalidServerUrlError(), 400],
    [new PdsMoveOutInProgressError(), 409],
    [new PdsMoveOutNotFoundError(), 409],
    [new PdsMoveOutSwitchedError(), 409],
    [new PdsAccountMovedError('dest.pds.example'), 409],
    [new PdsHostedRateLimitedError(), 429],
    [new PdsMoveOutRemoteError('Destination server refused request'), 502],
    [new PdsMoveOutInvalidCredentialsError(), 502],
    [new PlcDirectoryError('PLC directory down', 500), 502]
  ])(
    'maps %s to HTTP %i with { error } body',
    async (error, expectedStatus) => {
      vi.mocked(sendMoveOutRepo).mockRejectedValueOnce(error)
      const response = await call('POST', { step: 'repo' })
      expect(response.status).toBe(expectedStatus)
      expect(await response.json()).toMatchObject({
        error: expect.any(String)
      })
    }
  )
})

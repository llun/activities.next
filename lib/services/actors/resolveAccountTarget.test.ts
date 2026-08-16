import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import {
  ACCOUNT_TARGET_MAX_LENGTH,
  parseAccountTarget,
  resolveAccountTarget
} from './resolveAccountTarget'

vi.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: vi.fn()
}))

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn(),
  isLocalFederationDomain: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: vi.fn()
}))

vi.mock('./refreshRemoteActor', () => ({
  recordRemoteActorBestEffort: vi.fn()
}))

const { getWebfingerSelf } = await vi.importMock<
  typeof import('@/lib/activities/getWebfingerSelf')
>('@/lib/activities/getWebfingerSelf')
const { getActorPerson } = await vi.importMock<
  typeof import('@/lib/activities/getActorPerson')
>('@/lib/activities/getActorPerson')
const { canFederateWithDomain, isLocalFederationDomain } = await vi.importMock<
  typeof import('@/lib/services/federation/domainPolicy')
>('@/lib/services/federation/domainPolicy')
const { getFederationSigningActorSafe } = await vi.importMock<
  typeof import('@/lib/services/federation/getFederationSigningActor')
>('@/lib/services/federation/getFederationSigningActor')
const { recordRemoteActorBestEffort } = await vi.importMock<
  typeof import('./refreshRemoteActor')
>('./refreshRemoteActor')

const remoteActor = {
  id: 'https://remote.test/users/someone',
  username: 'someone',
  domain: 'remote.test'
} as Actor

const localActor = {
  id: 'https://llun.test/users/local',
  username: 'local',
  domain: 'llun.test',
  privateKey: 'private-key'
} as Actor

const mockDatabase = {
  getActorFromUsername: vi.fn(),
  getActorFromId: vi.fn()
}

const database = mockDatabase as unknown as Database

// The real canFederateWithDomain resolves the value to a HOST before deciding,
// so a mock matching on the raw string is a trap: `https://a.test/@u@b.test`
// contains "b.test" as a substring and would answer as though b.test had been
// gated, hiding exactly the bug these tests exist to catch.
const blockDomains =
  (...blocked: string[]) =>
  async (_database: Database, value: string) => {
    const host = (() => {
      try {
        return new URL(value).hostname
      } catch {
        return value.split('/')[0] ?? value
      }
    })()
    return !blocked.includes(host.toLowerCase())
  }

describe('parseAccountTarget', () => {
  it.each([
    {
      description: 'accepts a bare handle',
      input: 'user@remote.test',
      expected: {
        type: 'handle',
        username: 'user',
        domain: 'remote.test',
        acct: 'user@remote.test'
      }
    },
    {
      description: 'accepts a handle with a leading at sign',
      input: '@user@remote.test',
      expected: {
        type: 'handle',
        username: 'user',
        domain: 'remote.test',
        acct: 'user@remote.test'
      }
    },
    {
      description: 'accepts an acct uri',
      input: 'acct:user@remote.test',
      expected: {
        type: 'handle',
        username: 'user',
        domain: 'remote.test',
        acct: 'user@remote.test'
      }
    },
    {
      description: 'lowercases the handle domain',
      input: 'user@Remote.TEST',
      expected: {
        type: 'handle',
        username: 'user',
        domain: 'remote.test',
        acct: 'user@remote.test'
      }
    },
    {
      description: 'accepts a profile url',
      input: 'https://remote.test/@user',
      expected: { type: 'url', url: 'https://remote.test/@user' }
    },
    {
      description: 'accepts an activitypub actor uri',
      input: 'https://remote.test/users/user',
      expected: { type: 'url', url: 'https://remote.test/users/user' }
    },
    {
      description: 'accepts a status url for later rejection at resolution',
      input: 'https://remote.test/@user/12345',
      expected: { type: 'url', url: 'https://remote.test/@user/12345' }
    },
    {
      description: 'accepts an http url for local development',
      input: 'http://localhost:3000/users/user',
      expected: { type: 'url', url: 'http://localhost:3000/users/user' }
    },
    {
      description: 'rejects a bare domain',
      input: 'remote.test',
      expected: null
    },
    { description: 'rejects an empty value', input: '', expected: null },
    { description: 'rejects whitespace only', input: '   ', expected: null },
    {
      description: 'rejects a handle with two domains',
      input: 'user@remote.test@evil.test',
      expected: null
    },
    {
      description: 'rejects a javascript url',
      input: 'javascript:alert(1)',
      expected: null
    },
    {
      description: 'rejects a data url',
      input: 'data:text/html,<script>alert(1)</script>',
      expected: null
    }
  ])('$description', ({ input, expected }) => {
    expect(parseAccountTarget(input)).toEqual(expected)
  })

  it('rejects input longer than the maximum length', () => {
    const longDomain = `${'a'.repeat(ACCOUNT_TARGET_MAX_LENGTH)}.test`
    expect(parseAccountTarget(`user@${longDomain}`)).toBeNull()
  })
})

describe('resolveAccountTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorFromUsername.mockResolvedValue(null)
    mockDatabase.getActorFromId.mockResolvedValue(null)
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(isLocalFederationDomain).mockResolvedValue(false)
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue(undefined)
    vi.mocked(getWebfingerSelf).mockResolvedValue(null)
    vi.mocked(getActorPerson).mockResolvedValue(null)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(null)
  })

  it('returns invalid for an unparseable target', async () => {
    const result = await resolveAccountTarget({ database, input: 'banana' })

    expect(result).toEqual({ type: 'invalid' })
    expect(canFederateWithDomain).not.toHaveBeenCalled()
  })

  it('returns forbidden when the instance cannot federate with the domain', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    const result = await resolveAccountTarget({
      database,
      input: 'user@blocked.test'
    })

    expect(result).toEqual({ type: 'forbidden' })
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })

  it('resolves a known handle without any outbound request', async () => {
    mockDatabase.getActorFromUsername.mockResolvedValue(localActor)

    const result = await resolveAccountTarget({
      database,
      input: '@local@llun.test'
    })

    expect(result).toEqual({ type: 'resolved', actor: localActor })
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })

  it('does not webfinger its own domain for an unknown local handle', async () => {
    vi.mocked(isLocalFederationDomain).mockResolvedValue(true)

    const result = await resolveAccountTarget({
      database,
      input: 'ghost@llun.test'
    })

    expect(result).toEqual({ type: 'not-found' })
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })

  it('resolves an unknown remote handle through webfinger', async () => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(remoteActor.id)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(remoteActor)

    const result = await resolveAccountTarget({
      database,
      input: 'someone@remote.test'
    })

    expect(result).toEqual({ type: 'resolved', actor: remoteActor })
    expect(getWebfingerSelf).toHaveBeenCalledWith({
      account: 'someone@remote.test'
    })
  })

  it('returns not found when webfinger has no such account', async () => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(null)

    const result = await resolveAccountTarget({
      database,
      input: 'ghost@remote.test'
    })

    expect(result).toEqual({ type: 'not-found' })
    expect(recordRemoteActorBestEffort).not.toHaveBeenCalled()
  })

  it('refuses a profile url carrying a handle on a domain it cannot federate with', async () => {
    // The wrapper host is allowed and the embedded domain is not; gating only
    // the URL's own host let the blocked domain through, while the same
    // account written as a bare handle was correctly refused.
    vi.mocked(canFederateWithDomain).mockImplementation(
      blockDomains('blocked.test')
    )

    const result = await resolveAccountTarget({
      database,
      input: 'https://mastodon.social/@spammer@blocked.test'
    })

    expect(result).toEqual({ type: 'forbidden' })
    expect(mockDatabase.getActorFromUsername).not.toHaveBeenCalled()
    expect(getWebfingerSelf).not.toHaveBeenCalled()
  })

  it('refuses both spellings of an account on a domain it cannot federate with', async () => {
    vi.mocked(canFederateWithDomain).mockImplementation(
      blockDomains('blocked.test')
    )

    const asHandle = await resolveAccountTarget({
      database,
      input: 'spammer@blocked.test'
    })
    const asWrappedProfileUrl = await resolveAccountTarget({
      database,
      input: 'https://mastodon.social/@spammer@blocked.test'
    })

    expect(asWrappedProfileUrl).toEqual(asHandle)
  })

  it('still resolves a profile url whose embedded domain is allowed', async () => {
    vi.mocked(canFederateWithDomain).mockImplementation(
      blockDomains('blocked.test')
    )
    vi.mocked(getWebfingerSelf).mockResolvedValue(remoteActor.id)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(remoteActor)

    const result = await resolveAccountTarget({
      database,
      input: 'https://mastodon.social/@someone@remote.test'
    })

    expect(result).toEqual({ type: 'resolved', actor: remoteActor })
  })

  it('re-checks federation policy against the actor id webfinger returns', async () => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(
      'https://elsewhere.test/users/someone'
    )
    vi.mocked(canFederateWithDomain).mockImplementation(
      blockDomains('elsewhere.test')
    )

    const result = await resolveAccountTarget({
      database,
      input: 'someone@remote.test'
    })

    expect(result).toEqual({ type: 'forbidden' })
    expect(recordRemoteActorBestEffort).not.toHaveBeenCalled()
  })

  it('returns not found when the remote actor cannot be recorded', async () => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(remoteActor.id)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(null)

    const result = await resolveAccountTarget({
      database,
      input: 'someone@remote.test'
    })

    expect(result).toEqual({ type: 'not-found' })
  })

  it('resolves a stored actor uri without any outbound request', async () => {
    mockDatabase.getActorFromId.mockResolvedValue(remoteActor)

    const result = await resolveAccountTarget({
      database,
      input: remoteActor.id
    })

    expect(result).toEqual({ type: 'resolved', actor: remoteActor })
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('resolves a profile url through the handle path', async () => {
    vi.mocked(getWebfingerSelf).mockResolvedValue(remoteActor.id)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(remoteActor)

    const result = await resolveAccountTarget({
      database,
      input: 'https://remote.test/@someone'
    })

    expect(result).toEqual({ type: 'resolved', actor: remoteActor })
    expect(getWebfingerSelf).toHaveBeenCalledWith({
      account: 'someone@remote.test'
    })
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('resolves an unknown actor uri by fetching the person document', async () => {
    vi.mocked(getActorPerson).mockResolvedValue({
      id: remoteActor.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(recordRemoteActorBestEffort).mockResolvedValue(remoteActor)

    const result = await resolveAccountTarget({
      database,
      input: remoteActor.id
    })

    expect(result).toEqual({ type: 'resolved', actor: remoteActor })
    expect(recordRemoteActorBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: remoteActor.id })
    )
  })

  it('returns not found for a status url that is not an actor', async () => {
    vi.mocked(getActorPerson).mockResolvedValue(null)

    const result = await resolveAccountTarget({
      database,
      input: 'https://remote.test/users/someone/statuses/12345'
    })

    expect(result).toEqual({ type: 'not-found' })
    expect(recordRemoteActorBestEffort).not.toHaveBeenCalled()
  })

  it('re-checks federation policy against the canonical actor id', async () => {
    vi.mocked(getActorPerson).mockResolvedValue({
      id: 'https://elsewhere.test/users/someone'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(canFederateWithDomain).mockImplementation(
      blockDomains('elsewhere.test')
    )

    const result = await resolveAccountTarget({
      database,
      input: 'https://remote.test/users/someone'
    })

    expect(result).toEqual({ type: 'forbidden' })
    expect(recordRemoteActorBestEffort).not.toHaveBeenCalled()
  })
})

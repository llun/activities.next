import { getPdsConfig } from '@/lib/config/blueskyPds'
import type { PdsRepo } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'

import {
  PdsAccountDeactivatedError,
  PdsAccountNotFoundError,
  PdsAccountTakedownError
} from './errors'
import { requireActiveHostedPrincipal } from './principal'

vi.mock('@/lib/config/blueskyPds', () => ({
  getPdsConfig: vi.fn()
}))

const DOMAIN = 'example.com'
const DID = 'did:web:alice.pds.example.com'

const setPdsConfig = (enabled = true) => {
  vi.mocked(getPdsConfig).mockReturnValue({
    [DOMAIN]: {
      domain: DOMAIN,
      enabled,
      hostname: 'pds.example.com',
      did: 'did:web:pds.example.com',
      allowEmails: [],
      allowActors: [],
      relays: [],
      clientSignIn: false
    }
  })
}

const makeRepo = (overrides: Partial<PdsRepo> = {}): PdsRepo => ({
  did: DID,
  actorId: 'actor-1',
  domain: DOMAIN,
  signingKeyDid: 'did:key:zSigning',
  rootCid: null,
  rev: null,
  status: 'active',
  handle: 'alice.pds.example.com',
  recoveryKeyDid: null,
  plcOperation: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const makeActor = (overrides: Record<string, unknown> = {}): Actor =>
  ({
    id: 'actor-1',
    username: 'alice',
    domain: DOMAIN,
    publicKey: 'pub',
    suspendedAt: null,
    deletionStatus: null,
    account: {
      id: 'account-1',
      email: 'alice@example.com',
      approvedAt: 1,
      disabledAt: null,
      verificationCode: '',
      emailVerified: true
    },
    ...overrides
  }) as unknown as Actor

const makeDatabase = ({
  repo = makeRepo(),
  actor = makeActor()
}: {
  repo?: PdsRepo | null
  actor?: Actor | null
} = {}): Database =>
  ({
    getPdsRepo: vi.fn().mockResolvedValue(repo),
    getActorFromId: vi.fn().mockResolvedValue(actor)
  }) as unknown as Database

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
  errorClass: new (...args: never[]) => Error
) => {
  await expect(promise).rejects.toBeInstanceOf(errorClass)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('requireActiveHostedPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPdsConfig()
  })

  it('returns the repo and actor for an active hosted account', async () => {
    const repo = makeRepo()
    const actor = makeActor()
    const database = makeDatabase({ repo, actor })

    await expect(
      requireActiveHostedPrincipal(database, { did: DID, domain: DOMAIN })
    ).resolves.toEqual({ repo, actor })
  })

  it('throws AccountNotFound when the domain PDS is disabled', async () => {
    setPdsConfig(false)
    await expectCode(
      requireActiveHostedPrincipal(makeDatabase(), {
        did: DID,
        domain: DOMAIN
      }),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountNotFound when the domain has no PDS config', async () => {
    vi.mocked(getPdsConfig).mockReturnValue(null)
    await expectCode(
      requireActiveHostedPrincipal(makeDatabase(), {
        did: DID,
        domain: DOMAIN
      }),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountNotFound when the repo does not exist', async () => {
    await expectCode(
      requireActiveHostedPrincipal(makeDatabase({ repo: null }), {
        did: DID,
        domain: DOMAIN
      }),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountNotFound when the repo belongs to another domain', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ repo: makeRepo({ domain: 'other.test' }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountNotFound when the actor does not exist', async () => {
    await expectCode(
      requireActiveHostedPrincipal(makeDatabase({ actor: null }), {
        did: DID,
        domain: DOMAIN
      }),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountTakedown for a takendown repo', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ repo: makeRepo({ status: 'takendown' }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountTakedown',
      PdsAccountTakedownError
    )
  })

  it('throws AccountTakedown for a suspended actor', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ actor: makeActor({ suspendedAt: 1 }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountTakedown',
      PdsAccountTakedownError
    )
  })

  it('throws AccountTakedown for a disabled account', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({
          actor: makeActor({
            account: {
              id: 'account-1',
              email: 'alice@example.com',
              approvedAt: 1,
              disabledAt: 1,
              verificationCode: '',
              emailVerified: true
            }
          })
        }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountTakedown',
      PdsAccountTakedownError
    )
  })

  it('throws AccountDeactivated for a deactivated repo', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ repo: makeRepo({ status: 'deactivated' }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountDeactivated',
      PdsAccountDeactivatedError
    )
  })

  it('throws AccountDeactivated for a deleting actor', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ actor: makeActor({ deletionStatus: 'deleting' }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountDeactivated',
      PdsAccountDeactivatedError
    )
  })

  it('throws AccountDeactivated for an unapproved account', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({
          actor: makeActor({
            account: {
              id: 'account-1',
              email: 'alice@example.com',
              approvedAt: null,
              disabledAt: null,
              verificationCode: '',
              emailVerified: true
            }
          })
        }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountDeactivated',
      PdsAccountDeactivatedError
    )
  })

  it('throws AccountDeactivated for an unconfirmed account', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({
          actor: makeActor({
            account: {
              id: 'account-1',
              email: 'alice@example.com',
              approvedAt: 1,
              disabledAt: null,
              verificationCode: 'code',
              emailVerified: false
            }
          })
        }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountDeactivated',
      PdsAccountDeactivatedError
    )
  })

  it('throws AccountNotFound for a deleted repo', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({ repo: makeRepo({ status: 'deleted' }) }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountNotFound',
      PdsAccountNotFoundError
    )
  })

  it('throws AccountDeactivated when the account has moved out', async () => {
    await expectCode(
      requireActiveHostedPrincipal(
        makeDatabase({
          repo: makeRepo({
            handle: null,
            plcOperation: JSON.stringify({
              services: {
                atproto_pds: { endpoint: 'https://other.example' }
              }
            })
          })
        }),
        { did: DID, domain: DOMAIN }
      ),
      'AccountDeactivated',
      PdsAccountDeactivatedError
    )
  })
})

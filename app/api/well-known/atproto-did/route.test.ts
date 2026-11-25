import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { isServedDomainSnapshotFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'

import { GET } from './route'

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/services/guards/headerHost', () => ({ headerHost: vi.fn() }))
vi.mock(
  '@/lib/services/domains/servedDomainSnapshot',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isServedDomainSnapshotFresh: vi.fn()
  })
)

const getBlueskyAccountByInstanceHandle = vi.fn()
const getActorFromId = vi.fn()
const getPdsRepoByHandle = vi.fn()
const isEligibleInstanceHandleHolder = vi.fn()
const database = {
  getBlueskyAccountByInstanceHandle,
  getActorFromId,
  getPdsRepoByHandle,
  isEligibleInstanceHandleHolder
}

// An actor whose hosted repo is effectively active: approved, not suspended,
// disabled or being deleted.
const activeActor = {
  id: 'actor-a',
  suspendedAt: null,
  deletionStatus: null,
  account: { approvedAt: 1, disabledAt: null, verificationCode: null }
}
const suspendedActor = { ...activeActor, suspendedAt: 2 }

// The real host parsing reads this PDS configuration.
const PDS_ENV = JSON.stringify({
  'social.example': {
    enabled: true,
    hostname: 'pds.social.example',
    allowEmails: [],
    allowActors: []
  }
})
const subdomainHandle = { handle: 'alice.pds.social.example' }

const hostedRepo = (
  handle: string,
  status: 'active' | 'deactivated' = 'active'
) => ({ did: 'did:plc:hostedalice', actorId: 'actor-a', status, handle })

const linkedClaim = { did: 'did:plc:linkedoutside', actorId: 'actor-a' }

// The Host the request arrives with; headerHost (mocked) says which served
// host it maps to.
let requestHost = 'social.example'
const call = () =>
  GET(
    new NextRequest(`https://${requestHost}/.well-known/atproto-did`, {
      headers: { host: requestHost }
    }),
    { params: Promise.resolve({}) }
  )

describe('GET /.well-known/atproto-did', () => {
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS

  afterAll(() => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
  })

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ACTIVITIES_BLUESKY_PDS = PDS_ENV
    requestHost = 'social.example'
    vi.mocked(getDatabase).mockReturnValue(database as never)
    // The served-domain rules the subdomain parsing checks against.
    vi.mocked(getConfig).mockReturnValue({ host: 'social.example' } as never)
    vi.mocked(headerHost).mockReturnValue('social.example')
    getPdsRepoByHandle.mockResolvedValue(null)
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)
    getActorFromId.mockResolvedValue(activeActor)
    isEligibleInstanceHandleHolder.mockResolvedValue(true)
    vi.mocked(isServedDomainSnapshotFresh).mockReturnValue(true)
  })

  it('answers the claimed DID for the served host the request is for', async () => {
    // headerHost resolves the served host (or the primary one behind a proxy
    // that rewrites Host); the claim is looked up in its canonical form.
    vi.mocked(headerHost).mockReturnValue('Social.Example:443')
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('did:plc:linkedoutside')
    expect(getPdsRepoByHandle).toHaveBeenCalledWith({
      handle: 'social.example'
    })
    expect(getBlueskyAccountByInstanceHandle).toHaveBeenCalledWith({
      host: 'social.example'
    })
  })

  it('answers 404 for a host nobody claimed or holds', async () => {
    vi.mocked(headerHost).mockReturnValue('other.example')
    const response = await call()
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  it('answers the hosted repo DID for a <username>.<PDS host> handle', async () => {
    requestHost = subdomainHandle.handle
    getPdsRepoByHandle.mockResolvedValue(hostedRepo(subdomainHandle.handle))

    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('did:plc:hostedalice')
    expect(getPdsRepoByHandle).toHaveBeenCalledWith({
      handle: 'alice.pds.social.example'
    })
    expect(getActorFromId).toHaveBeenCalledWith({ id: 'actor-a' })
    expect(getBlueskyAccountByInstanceHandle).not.toHaveBeenCalled()
  })

  it('answers the hosted repo DID for a served domain a hosted account holds', async () => {
    getPdsRepoByHandle.mockResolvedValue(hostedRepo('social.example'))
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('did:plc:hostedalice')
  })

  it('does not answer a PDS subdomain no live repo holds', async () => {
    requestHost = subdomainHandle.handle

    const response = await call()

    expect(response.status).toBe(404)
  })

  it('does not answer a PDS subdomain whose repo is not active', async () => {
    requestHost = subdomainHandle.handle
    getPdsRepoByHandle.mockResolvedValue(
      hostedRepo(subdomainHandle.handle, 'deactivated')
    )

    const response = await call()

    expect(response.status).toBe(404)
  })

  it('answers 404 for a suspended actor’s hosted <username>.<PDS host> handle', async () => {
    requestHost = subdomainHandle.handle
    // The stored status lags moderation; the effective status is takendown.
    getPdsRepoByHandle.mockResolvedValue(hostedRepo(subdomainHandle.handle))
    getActorFromId.mockResolvedValue(suspendedActor)

    const response = await call()

    expect(response.status).toBe(404)
  })

  // An eligible hosted holder decides the host: a linked claim that
  // coexists with it (a stale claim whose holder was reinstated, a race) is
  // never answered in its place.
  it('answers 404, not a coexisting linked claim, for an unapproved actor’s hosted host', async () => {
    getPdsRepoByHandle.mockResolvedValue(hostedRepo('social.example'))
    // Still an eligible holder, but not effectively active.
    getActorFromId.mockResolvedValue({
      ...activeActor,
      account: { ...activeActor.account, approvedAt: null }
    })
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    const response = await call()

    expect(response.status).toBe(404)
    expect(getBlueskyAccountByInstanceHandle).not.toHaveBeenCalled()
  })

  it('answers 404, not a coexisting linked claim, for a host whose hosted repo is turned off', async () => {
    getPdsRepoByHandle.mockResolvedValue(
      hostedRepo('social.example', 'deactivated')
    )
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    const response = await call()

    expect(response.status).toBe(404)
  })

  it('passes over a hosted holder who may no longer hold the served domain', async () => {
    getPdsRepoByHandle.mockResolvedValue(hostedRepo('social.example'))
    isEligibleInstanceHandleHolder.mockResolvedValue(false)

    expect((await call()).status).toBe(404)
    expect(isEligibleInstanceHandleHolder).toHaveBeenCalledWith({
      actorId: 'actor-a',
      host: 'social.example'
    })

    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)
    expect(await (await call()).text()).toBe('did:plc:linkedoutside')
  })

  it('answers no hosted DID for an untrusted Host while the served-domain snapshot is not fresh', async () => {
    vi.mocked(isServedDomainSnapshotFresh).mockReturnValue(false)
    // An untrusted Host falls back to the primary host.
    requestHost = 'evil.example'
    getPdsRepoByHandle.mockResolvedValue(hostedRepo('social.example'))

    expect((await call()).status).toBe(404)
    expect(getPdsRepoByHandle).not.toHaveBeenCalled()

    // The linked claim keeps answering as before.
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)
    expect(await (await call()).text()).toBe('did:plc:linkedoutside')
  })

  it('answers 404, not a claim, for a PDS subdomain whose repo is turned off', async () => {
    requestHost = subdomainHandle.handle
    getPdsRepoByHandle.mockResolvedValue(
      hostedRepo(subdomainHandle.handle, 'deactivated')
    )
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    expect((await call()).status).toBe(404)
  })

  it('still answers the served host’s eligible hosted holder after a failed snapshot load', async () => {
    // Not fresh after a failed load, but the request's own host is the one
    // served, so no fallback is involved.
    vi.mocked(isServedDomainSnapshotFresh).mockReturnValue(false)
    getPdsRepoByHandle.mockResolvedValue(hostedRepo('social.example'))
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    const response = await call()

    expect(await response.text()).toBe('did:plc:hostedalice')
  })

  it('answers 404, never the primary host’s claim, for a PDS subdomain while the snapshot is not fresh', async () => {
    vi.mocked(isServedDomainSnapshotFresh).mockReturnValue(false)
    requestHost = 'alice.pds.social.example:443'
    getBlueskyAccountByInstanceHandle.mockResolvedValue(linkedClaim)

    const response = await call()

    expect(response.status).toBe(404)
    expect(getPdsRepoByHandle).not.toHaveBeenCalled()
    expect(getBlueskyAccountByInstanceHandle).not.toHaveBeenCalled()
  })
})

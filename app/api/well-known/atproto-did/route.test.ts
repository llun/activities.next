import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getPdsSubdomainHandle } from '@/lib/services/pds/host'

import { GET } from './route'

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/services/guards/headerHost', () => ({ headerHost: vi.fn() }))
vi.mock('@/lib/services/pds/host', () => ({ getPdsSubdomainHandle: vi.fn() }))

const getBlueskyAccountByInstanceHandle = vi.fn()
const getActorFromUsername = vi.fn()
const getPdsRepo = vi.fn()
const database = {
  getBlueskyAccountByInstanceHandle,
  getActorFromUsername,
  getPdsRepo
}

const call = () =>
  GET(new NextRequest('https://social.example/.well-known/atproto-did'), {
    params: Promise.resolve({})
  })

describe('GET /.well-known/atproto-did', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getDatabase).mockReturnValue(database as never)
    vi.mocked(getPdsSubdomainHandle).mockReturnValue(null)
  })

  it('answers the DID for the served host the request is for', async () => {
    // headerHost resolves the served host (or the primary one behind a proxy
    // that rewrites Host); the claim is looked up in its canonical form.
    vi.mocked(headerHost).mockReturnValue('Social.Example:443')
    getBlueskyAccountByInstanceHandle.mockResolvedValue({
      did: 'did:plc:abc123',
      actorId: 'actor-a'
    })
    getPdsRepo.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('did:plc:abc123')
    expect(getBlueskyAccountByInstanceHandle).toHaveBeenCalledWith({
      host: 'social.example'
    })
  })

  it('answers 404 for a host nobody claimed', async () => {
    vi.mocked(headerHost).mockReturnValue('other.example')
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  it('answers the hosted repo DID for a <username>.<PDS host> handle', async () => {
    vi.mocked(getPdsSubdomainHandle).mockReturnValue({
      username: 'alice',
      domain: 'social.example',
      handle: 'alice.pds.social.example'
    })
    getActorFromUsername.mockResolvedValue({ id: 'actor-a' })
    getPdsRepo.mockResolvedValue({
      did: 'did:plc:hostedalice',
      status: 'active',
      handle: 'alice.pds.social.example'
    })

    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('did:plc:hostedalice')
    expect(getActorFromUsername).toHaveBeenCalledWith({
      username: 'alice',
      domain: 'social.example'
    })
    // The instance-handle lookup is not reached for a PDS subdomain.
    expect(getBlueskyAccountByInstanceHandle).not.toHaveBeenCalled()
  })

  it('does not answer a PDS subdomain whose repo handle differs', async () => {
    vi.mocked(getPdsSubdomainHandle).mockReturnValue({
      username: 'alice',
      domain: 'social.example',
      handle: 'alice.pds.social.example'
    })
    getActorFromUsername.mockResolvedValue({ id: 'actor-a' })
    getPdsRepo.mockResolvedValue({
      did: 'did:plc:hostedalice',
      status: 'active',
      handle: 'alice.example.com'
    })
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)

    const response = await call()

    expect(response.status).toBe(404)
  })

  it('does not answer a PDS subdomain whose repo is not active', async () => {
    vi.mocked(getPdsSubdomainHandle).mockReturnValue({
      username: 'alice',
      domain: 'social.example',
      handle: 'alice.pds.social.example'
    })
    getActorFromUsername.mockResolvedValue({ id: 'actor-a' })
    getPdsRepo.mockResolvedValue({
      did: 'did:plc:hostedalice',
      status: 'deactivated',
      handle: 'alice.pds.social.example'
    })
    getBlueskyAccountByInstanceHandle.mockResolvedValue(null)

    const response = await call()

    expect(response.status).toBe(404)
  })

  it('prefers the hosted repo DID over the linked DID for a claimed handle', async () => {
    vi.mocked(headerHost).mockReturnValue('social.example')
    getBlueskyAccountByInstanceHandle.mockResolvedValue({
      did: 'did:plc:linkedoutside',
      actorId: 'actor-a'
    })
    getPdsRepo.mockResolvedValue({
      did: 'did:plc:hostedalice',
      status: 'active',
      handle: 'social.example'
    })

    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('did:plc:hostedalice')
  })
})

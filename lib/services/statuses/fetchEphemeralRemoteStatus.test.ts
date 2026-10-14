import type { Database } from '@/lib/database/types'
import { fetchEphemeralRemoteStatus } from '@/lib/services/statuses/fetchEphemeralRemoteStatus'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const {
  mockGetNote,
  mockIsLocalFederationDomain,
  mockCanFederateWithDomain,
  mockGetFederationSigningActorSafe,
  mockRecordRemoteActorBestEffort
} = vi.hoisted(() => ({
  mockGetNote: vi.fn(),
  mockIsLocalFederationDomain: vi.fn(),
  mockCanFederateWithDomain: vi.fn(),
  mockGetFederationSigningActorSafe: vi.fn(),
  mockRecordRemoteActorBestEffort: vi.fn()
}))

vi.mock('@/lib/activities', () => ({
  getNote: mockGetNote
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: mockIsLocalFederationDomain,
  canFederateWithDomain: mockCanFederateWithDomain
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: mockGetFederationSigningActorSafe
}))

vi.mock('@/lib/services/actors/refreshRemoteActor', () => ({
  recordRemoteActorBestEffort: mockRecordRemoteActorBestEffort
}))

const statusUrl = 'https://toot.io/users/devstorm/statuses/117434164364383111'
const authorId = 'https://toot.io/users/devstorm'
const signingActor = { id: 'https://local.test/actor' } as Actor
const author = { id: authorId } as Actor
const viewer = { id: 'https://local.test/users/me' } as Actor

const makeNote = (overrides: Record<string, unknown> = {}) => ({
  id: statusUrl,
  type: 'Note',
  attributedTo: authorId,
  content: '<p>Hola mundo</p>',
  published: '2026-01-01T00:00:00Z',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [`${authorId}/followers`],
  ...overrides
})

const mockGetActorFromId = vi.fn()
const database = {
  getActorFromId: mockGetActorFromId
} as unknown as Database

const fetchStatus = (statusId = statusUrl) =>
  fetchEphemeralRemoteStatus({ database, statusId })

describe('fetchEphemeralRemoteStatus', () => {
  beforeEach(() => {
    for (const mock of [
      mockGetNote,
      mockIsLocalFederationDomain,
      mockCanFederateWithDomain,
      mockGetFederationSigningActorSafe,
      mockRecordRemoteActorBestEffort,
      mockGetActorFromId
    ]) {
      mock.mockReset()
    }
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetFederationSigningActorSafe.mockResolvedValue(signingActor)
    mockGetNote.mockResolvedValue(makeNote())
    mockGetActorFromId.mockResolvedValue(author)
    mockRecordRemoteActorBestEffort.mockResolvedValue(null)
  })

  it('returns a public remote note fetched with the instance signer, without storing it', async () => {
    const status = await fetchStatus()

    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: statusUrl,
      signingActor
    })
    expect(status).toMatchObject({
      id: statusUrl,
      actorId: authorId
    })
    expect(mockRecordRemoteActorBestEffort).not.toHaveBeenCalled()
  })

  it('returns an unlisted remote note', async () => {
    mockGetNote.mockResolvedValue(
      makeNote({ to: [`${authorId}/followers`], cc: [ACTIVITY_STREAM_PUBLIC] })
    )
    expect(await fetchStatus()).toMatchObject({ id: statusUrl })
  })

  it.each([
    {
      description: 'an unknown publicId',
      statusId: '01928b1e-7c2f-7a00-8000-000000000000'
    },
    { description: 'a non-http URL', statusId: 'ftp://toot.io/statuses/1' }
  ])('returns null without fetching for $description', async ({ statusId }) => {
    expect(await fetchStatus(statusId)).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('returns null without fetching for a local domain', async () => {
    mockIsLocalFederationDomain.mockResolvedValue(true)
    expect(await fetchStatus()).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('returns null without fetching when the request domain may not federate', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)
    expect(await fetchStatus()).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('returns null when the author domain may not federate', async () => {
    mockCanFederateWithDomain.mockImplementation(
      async (_database: Database, value: string) => value !== authorId
    )
    expect(await fetchStatus()).toBeNull()
    expect(mockGetNote).toHaveBeenCalled()
  })

  it('returns null when the fetch fails', async () => {
    mockGetNote.mockResolvedValue(null)
    expect(await fetchStatus()).toBeNull()
  })

  it('returns null when the fetch throws', async () => {
    mockGetNote.mockRejectedValue(new Error('boom'))
    expect(await fetchStatus()).toBeNull()
  })

  it('returns null when the fetched id is on another origin', async () => {
    mockGetNote.mockResolvedValue(
      makeNote({
        id: 'https://evil.example/users/devstorm/statuses/1',
        attributedTo: 'https://evil.example/users/devstorm'
      })
    )
    expect(await fetchStatus()).toBeNull()
  })

  it('accepts a fetched id that is a same-origin alias of the requested URL', async () => {
    const requested = 'https://toot.io/@devstorm/117434164364383111'
    expect(await fetchStatus(requested)).toMatchObject({ id: statusUrl })
  })

  it('returns null when the author is on another origin than the note', async () => {
    mockGetNote.mockResolvedValue(
      makeNote({ attributedTo: 'https://local.test/users/alice' })
    )
    expect(await fetchStatus()).toBeNull()
    expect(mockGetActorFromId).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'followers-only',
      to: [`${authorId}/followers`],
      cc: []
    },
    { description: 'direct', to: [viewer.id], cc: [] }
  ])('returns null for a $description note', async ({ to, cc }) => {
    mockGetNote.mockResolvedValue(makeNote({ to, cc }))
    expect(await fetchStatus()).toBeNull()
  })

  it('records a missing author with the instance signer', async () => {
    mockGetActorFromId.mockResolvedValue(undefined)
    mockRecordRemoteActorBestEffort.mockResolvedValue(author)

    expect(await fetchStatus()).toMatchObject({ id: statusUrl })
    expect(mockRecordRemoteActorBestEffort).toHaveBeenCalledWith({
      actorId: authorId,
      database,
      signingActor
    })
  })

  it('returns null when a missing author cannot be recorded', async () => {
    mockGetActorFromId.mockResolvedValue(undefined)
    mockRecordRemoteActorBestEffort.mockResolvedValue(null)
    expect(await fetchStatus()).toBeNull()
  })
})

import type { Database } from '@/lib/database/types'
import { verifyQuoteInstrument } from '@/lib/services/quotes/verifyQuoteInstrument'

const { mockGetNote } = vi.hoisted(() => ({ mockGetNote: vi.fn() }))

vi.mock('@/lib/activities', () => ({
  getNote: mockGetNote
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi
    .fn()
    .mockResolvedValue({ id: 'https://ourhost.test/actor' })
}))

const REQUESTER = 'https://shared.example/users/mallory'
const INSTRUMENT = 'https://shared.example/users/mallory/statuses/9'
const TARGET = 'https://ourhost.test/users/bob/statuses/1'
const database = {} as Database

const params = (overrides: Record<string, string> = {}) => ({
  database,
  instrumentId: INSTRUMENT,
  requesterId: REQUESTER,
  quotedStatusId: TARGET,
  ...overrides
})

describe('verifyQuoteInstrument', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when the fetched note is authored by the requester and quotes the target', async () => {
    mockGetNote.mockResolvedValue({
      id: INSTRUMENT,
      attributedTo: REQUESTER,
      quote: TARGET
    })
    await expect(verifyQuoteInstrument(params())).resolves.toBe(true)
  })

  it('returns false when the fetched note is authored by a co-resident, not the requester', async () => {
    // The multi-user forgery: mallory names alice's note (same host) as the
    // instrument. Host equality is not enough; the dereferenced author must be
    // the requester.
    mockGetNote.mockResolvedValue({
      id: INSTRUMENT,
      attributedTo: 'https://shared.example/users/alice',
      quote: TARGET
    })
    await expect(verifyQuoteInstrument(params())).resolves.toBe(false)
  })

  it('returns false when the fetched note does not quote the target status', async () => {
    mockGetNote.mockResolvedValue({
      id: INSTRUMENT,
      attributedTo: REQUESTER,
      quote: 'https://ourhost.test/users/bob/statuses/other'
    })
    await expect(verifyQuoteInstrument(params())).resolves.toBe(false)
  })

  it('returns false when the canonical note id does not match the requested instrument id', async () => {
    // A redirect/alias that resolves to a different note (e.g. a co-resident's)
    // must not be accepted as the named instrument.
    mockGetNote.mockResolvedValue({
      id: 'https://shared.example/users/alice/statuses/999',
      attributedTo: REQUESTER,
      quote: TARGET
    })
    await expect(verifyQuoteInstrument(params())).resolves.toBe(false)
  })

  it('returns false when the instrument cannot be fetched', async () => {
    mockGetNote.mockResolvedValue(null)
    await expect(verifyQuoteInstrument(params())).resolves.toBe(false)
  })

  it('returns false when fetching throws', async () => {
    mockGetNote.mockRejectedValue(new Error('boom'))
    await expect(verifyQuoteInstrument(params())).resolves.toBe(false)
  })
})

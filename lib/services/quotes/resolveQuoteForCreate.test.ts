import type { Database } from '@/lib/database/types'
import { resolveQuoteForCreate } from '@/lib/services/quotes/resolveQuoteForCreate'
import type { Actor } from '@/lib/types/domain/actor'

const {
  mockCanActorReadStatus,
  mockCanQuoteStatus,
  mockFetchQuoteTargetForCreate
} = vi.hoisted(() => ({
  mockCanActorReadStatus: vi.fn(),
  mockCanQuoteStatus: vi.fn(),
  mockFetchQuoteTargetForCreate: vi.fn()
}))

vi.mock('@/lib/services/statusAccess', () => ({
  canActorReadStatus: mockCanActorReadStatus
}))
vi.mock('@/lib/services/quotes/canQuoteStatus', () => ({
  canQuoteStatus: mockCanQuoteStatus
}))
vi.mock('@/lib/services/quotes/fetchQuoteTargetForCreate', () => ({
  fetchQuoteTargetForCreate: mockFetchQuoteTargetForCreate
}))

const currentActor = { id: 'https://llun.test/users/me' } as Actor
const QUOTED_URL = 'https://llun.test/users/alice/statuses/1'

const makeDatabase = (
  overrides: Partial<{
    quotedStatus: unknown
    defaultQuotePolicy: 'public' | 'followers' | 'nobody' | undefined
  }> = {}
): Database =>
  ({
    getStatus: vi
      .fn()
      .mockResolvedValue(
        'quotedStatus' in overrides
          ? overrides.quotedStatus
          : { id: QUOTED_URL, actorId: 'https://llun.test/users/alice' }
      ),
    getActorSettings: vi
      .fn()
      .mockResolvedValue({ defaultQuotePolicy: overrides.defaultQuotePolicy })
  }) as unknown as Database

describe('resolveQuoteForCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanActorReadStatus.mockResolvedValue(true)
    mockCanQuoteStatus.mockResolvedValue('automatic')
    mockFetchQuoteTargetForCreate.mockResolvedValue(null)
  })

  it('resolves the quoted status id and defaults the policy from the actor setting', async () => {
    const database = makeDatabase({ defaultQuotePolicy: 'followers' })
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(result).toEqual({
      ok: true,
      quotedStatusId: QUOTED_URL,
      quoteApprovalPolicy: 'followers'
    })
  })

  it('prefers an explicit requested policy over the actor default', async () => {
    const database = makeDatabase({ defaultQuotePolicy: 'followers' })
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL,
      requestedPolicy: 'nobody'
    })
    expect(result).toMatchObject({ ok: true, quoteApprovalPolicy: 'nobody' })
  })

  it('returns ok with no quoted id and the default policy when nothing is quoted', async () => {
    const database = makeDatabase({ defaultQuotePolicy: 'public' })
    const result = await resolveQuoteForCreate({
      database,
      currentActor
    })
    expect(result).toEqual({
      ok: true,
      quotedStatusId: undefined,
      quoteApprovalPolicy: 'public'
    })
  })

  it('returns not_found when the quoted status does not exist and fetch returns null', async () => {
    const database = makeDatabase({ quotedStatus: null })
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(mockFetchQuoteTargetForCreate).toHaveBeenCalledWith({
      database,
      quotedStatusId: QUOTED_URL
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('fetches unstored remote quote target on database miss and uses its canonical id', async () => {
    const database = makeDatabase({ quotedStatus: null })
    const canonicalId = 'https://remote.test/users/alice/statuses/canonical-1'
    mockFetchQuoteTargetForCreate.mockResolvedValue({
      id: canonicalId,
      actorId: 'https://remote.test/users/alice'
    })
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(mockFetchQuoteTargetForCreate).toHaveBeenCalledWith({
      database,
      quotedStatusId: QUOTED_URL
    })
    expect(result).toEqual({
      ok: true,
      quotedStatusId: canonicalId,
      quoteApprovalPolicy: undefined
    })
  })

  it('does not call fetchQuoteTargetForCreate when the status is already stored', async () => {
    const database = makeDatabase()
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(mockFetchQuoteTargetForCreate).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      quotedStatusId: QUOTED_URL,
      quoteApprovalPolicy: undefined
    })
  })

  it('returns not_found when the quoted status is not readable by the caller', async () => {
    mockCanActorReadStatus.mockResolvedValue(false)
    const database = makeDatabase()
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns denied when the quote policy denies the caller', async () => {
    mockCanQuoteStatus.mockResolvedValue('denied')
    const database = makeDatabase()
    const result = await resolveQuoteForCreate({
      database,
      currentActor,
      quotedStatusId: QUOTED_URL
    })
    expect(result).toEqual({ ok: false, reason: 'denied' })
  })
})

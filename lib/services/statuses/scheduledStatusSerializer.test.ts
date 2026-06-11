import {
  ScheduledStatusInput,
  buildScheduledParams
} from '@/lib/services/statuses/scheduledStatusSerializer'

const baseNote = (
  overrides: Partial<ScheduledStatusInput> = {}
): ScheduledStatusInput => ({
  status: 'Scheduled note',
  sensitive: false,
  media_ids: [],
  ...overrides
})

describe('buildScheduledParams', () => {
  it('defaults visibility to public when neither the note nor a default is provided', () => {
    const params = buildScheduledParams(baseNote(), null)
    expect(params.visibility).toBe('public')
  })

  it('falls back to the provided default privacy when the note omits visibility', () => {
    const params = buildScheduledParams(baseNote(), null, 'private')
    expect(params.visibility).toBe('private')
  })

  it('prefers the explicit note visibility over the default privacy', () => {
    const params = buildScheduledParams(
      baseNote({ visibility: 'unlisted' }),
      null,
      'private'
    )
    expect(params.visibility).toBe('unlisted')
  })

  it('de-duplicates media ids and stores an empty list as null', () => {
    const withMedia = buildScheduledParams(
      baseNote({ media_ids: ['1', '1', '2'] }),
      null
    )
    expect(withMedia.media_ids).toEqual(['1', '2'])

    const withoutMedia = buildScheduledParams(baseNote(), null)
    expect(withoutMedia.media_ids).toBeNull()
  })

  it('carries the idempotency key through to params', () => {
    const params = buildScheduledParams(baseNote(), 'idem-key-1')
    expect(params.idempotency).toBe('idem-key-1')
  })

  it('stores the application id when provided and defaults it to null', () => {
    const withApp = buildScheduledParams(baseNote(), null, 'public', 'client-1')
    expect(withApp.application_id).toBe('client-1')

    const withoutApp = buildScheduledParams(baseNote(), null)
    expect(withoutApp.application_id).toBeNull()
  })
})

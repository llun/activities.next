import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/utils/logger'

import { resolveStravaDefaultVisibility } from './defaultVisibility'

describe('resolveStravaDefaultVisibility', () => {
  // `vi.spyOn` on an already-spied method returns the SAME spy, calls and all,
  // so without the restore each test would see the previous one's warnings.
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { description: 'keeps a stored public', storedVisibility: 'public' },
    { description: 'keeps a stored unlisted', storedVisibility: 'unlisted' },
    { description: 'keeps a stored private', storedVisibility: 'private' },
    { description: 'keeps a stored direct', storedVisibility: 'direct' }
  ])('$description', ({ storedVisibility }) => {
    expect(resolveStravaDefaultVisibility({ storedVisibility })).toBe(
      storedVisibility
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The arm every retry and repair path takes, and the one that had no test:
  // an actor who never picked a visibility must not have their activities
  // posted more widely than their followers.
  it.each([
    {
      description: 'defaults an unset visibility to private',
      stored: undefined
    },
    { description: 'defaults a null visibility to private', stored: null },
    { description: 'defaults an empty string to private', stored: '' }
  ])('$description', ({ stored }) => {
    expect(resolveStravaDefaultVisibility({ storedVisibility: stored })).toBe(
      'private'
    )
  })

  it('does not warn when nothing is stored', () => {
    resolveStravaDefaultVisibility({ storedVisibility: undefined })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The column is a plain varchar and the row mapper asserts rather than parses,
  // so a value the write path never would have produced still reaches here.
  it.each([
    { description: 'refuses an unknown visibility', stored: 'followers-only' },
    { description: 'refuses a cased visibility', stored: 'Public' },
    { description: 'refuses a numeric value', stored: '0' }
  ])('$description', ({ stored }) => {
    expect(resolveStravaDefaultVisibility({ storedVisibility: stored })).toBe(
      'private'
    )
  })

  it('warns with the actor and the rejected value', () => {
    resolveStravaDefaultVisibility({
      storedVisibility: 'followers-only',
      actorId: 'https://llun.test/users/test'
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid Strava default visibility; falling back to private',
        actorId: 'https://llun.test/users/test',
        defaultVisibility: 'followers-only'
      })
    )
  })

  it('carries the activity id when the caller has one', () => {
    resolveStravaDefaultVisibility({
      storedVisibility: 'nonsense',
      actorId: 'https://llun.test/users/test',
      stravaActivityId: '12345'
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stravaActivityId: '12345' })
    )
  })

  // The webhook route has no activity id to hand; the key should be ABSENT
  // rather than present-and-undefined.
  //
  // Asserted on the payload's own keys, not with
  // `not.objectContaining({ stravaActivityId: expect.anything() })` — that
  // passes either way, because `expect.anything()` does not match `undefined`,
  // so a present-but-undefined key satisfies the negation just as an absent
  // one does.
  it('omits the activity id when the caller has none', () => {
    resolveStravaDefaultVisibility({
      storedVisibility: 'nonsense',
      actorId: 'https://llun.test/users/test'
    })

    // Asserted before destructuring: without it, a resolver that stopped
    // warning would fail here as a TypeError on `undefined` rather than as a
    // readable expectation.
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [payload] = vi.mocked(logger.warn).mock.calls[0]
    expect(Object.keys(payload as object)).not.toContain('stravaActivityId')
  })
})

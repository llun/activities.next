import { BlueskyActionError, blueskyActionFailure } from './actionErrors'
import {
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError
} from './agent'
import { BlueskyLockTimeoutError } from './client'

const options = { lockPrefix: 'bluesky-like:', busy: 'Busy.' }

describe('blueskyActionFailure', () => {
  it('maps the typed errors to route answers', () => {
    expect(
      blueskyActionFailure(new BlueskyActionError('Nope.', 404), options)
    ).toEqual({ status: 404, error: 'Nope.' })
    expect(
      blueskyActionFailure(
        new BlueskyLockTimeoutError('bluesky-like:a:b'),
        options
      )
    ).toEqual({ status: 409, error: 'Busy.' })
    expect(
      blueskyActionFailure(new BlueskySessionChangedError(), options)?.status
    ).toBe(409)
    expect(
      blueskyActionFailure(new BlueskySessionEndedError(), options)?.status
    ).toBe(422)
    expect(
      blueskyActionFailure(
        new BlueskyRequestError('com.atproto.repo.createRecord', 500),
        options
      )?.status
    ).toBe(502)
  })

  it('leaves other errors and other locks to the caller', () => {
    expect(blueskyActionFailure(new Error('boom'), options)).toBeNull()
    expect(
      blueskyActionFailure(
        new BlueskyLockTimeoutError('bluesky-app-password-refresh:did'),
        options
      )
    ).toBeNull()
  })
})

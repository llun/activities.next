import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import { widensStatusAudience } from './widensStatusAudience'

const FOLLOWERS_URL = 'https://llun.test/users/test1/followers'
const NEW_ACTOR = 'https://grove.example/users/cedarpine'

describe('widensStatusAudience', () => {
  it('does not widen when a public post adds a newly mentioned recipient', () => {
    expect(
      widensStatusAudience(
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL] },
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL, NEW_ACTOR] }
      )
    ).toBe(false)
  })

  it('widens when a followers-only post adds a recipient', () => {
    expect(
      widensStatusAudience(
        { to: [FOLLOWERS_URL], cc: [] },
        { to: [FOLLOWERS_URL], cc: [NEW_ACTOR] }
      )
    ).toBe(true)
  })

  it('does not widen when an unlisted post becomes public', () => {
    expect(
      widensStatusAudience(
        { to: [FOLLOWERS_URL], cc: [ACTIVITY_STREAM_PUBLIC] },
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL] }
      )
    ).toBe(false)
  })

  it('does not widen between the two public spellings', () => {
    expect(
      widensStatusAudience(
        { to: [ACTIVITY_STREAM_PUBLIC_COMPACT], cc: [] },
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [] }
      )
    ).toBe(false)
  })

  it('widens when a direct post becomes public', () => {
    expect(
      widensStatusAudience(
        { to: [NEW_ACTOR], cc: [] },
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL] }
      )
    ).toBe(true)
  })

  it('does not widen when the audience is unchanged', () => {
    expect(
      widensStatusAudience(
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL] },
        { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS_URL] }
      )
    ).toBe(false)
  })
})

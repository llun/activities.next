import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import { getMastodonStatusDetailPath } from '@/lib/utils/getMastodonStatusDetailPath'
import { generatePublicId } from '@/lib/utils/publicId'

const createMockMastodonStatus = (
  overrides: Partial<MastodonStatus> = {}
): MastodonStatus =>
  ({
    id: 'https://remote.example/users/bob/statuses/1',
    url: 'https://remote.example/@bob/1',
    uri: 'https://remote.example/users/bob/statuses/1',
    content: '<p>test</p>',
    created_at: '2026-07-17T23:30:00.000Z',
    account: {
      acct: 'bob@remote.example',
      username: 'bob',
      display_name: 'Bob',
      avatar: 'https://remote.example/avatars/bob.png',
      url: 'https://remote.example/@bob',
      uri: 'https://remote.example/users/bob'
    },
    ...overrides
  }) as unknown as MastodonStatus

describe('getMastodonStatusDetailPath', () => {
  it('returns a path with publicId when status id is a publicId', () => {
    const publicId = generatePublicId()
    const status = createMockMastodonStatus({ id: publicId })

    expect(getMastodonStatusDetailPath(status)).toBe(
      `/@bob@remote.example/${publicId}`
    )
  })

  it('returns a path with percent-encoded URI when status id is not a publicId', () => {
    const uri = 'https://remote.example/users/bob/statuses/42'
    const status = createMockMastodonStatus({
      id: uri,
      uri
    })

    expect(getMastodonStatusDetailPath(status)).toBe(
      `/@bob@remote.example/${encodeURIComponent(uri)}`
    )
  })

  it('uses fallbackUri when status uri is missing and id is not a publicId', () => {
    const fallbackUri = 'https://remote.example/users/bob/statuses/fallback-99'
    const status = createMockMastodonStatus({
      id: 'legacy-id',
      uri: ''
    })

    expect(getMastodonStatusDetailPath(status, fallbackUri)).toBe(
      `/@bob@remote.example/${encodeURIComponent(fallbackUri)}`
    )
  })

  it('extracts domain from account url for local accounts with bare acct', () => {
    const publicId = generatePublicId()
    const status = createMockMastodonStatus({
      id: publicId,
      account: {
        acct: 'alice',
        username: 'alice',
        display_name: 'Alice',
        avatar: '',
        url: 'https://activities.local/@alice',
        uri: 'https://activities.local/users/alice'
      } as MastodonStatus['account']
    })

    expect(getMastodonStatusDetailPath(status)).toBe(
      `/@alice@activities.local/${publicId}`
    )
  })

  it('extracts domain from account uri when account url is invalid', () => {
    const publicId = generatePublicId()
    const status = createMockMastodonStatus({
      id: publicId,
      account: {
        acct: 'alice',
        username: 'alice',
        display_name: 'Alice',
        avatar: '',
        url: '',
        uri: 'https://activities.local/users/alice'
      } as MastodonStatus['account']
    })

    expect(getMastodonStatusDetailPath(status)).toBe(
      `/@alice@activities.local/${publicId}`
    )
  })

  it('falls back to bare acct when domain cannot be derived from url or uri', () => {
    const publicId = generatePublicId()
    const status = createMockMastodonStatus({
      id: publicId,
      account: {
        acct: 'alice',
        username: 'alice',
        display_name: 'Alice',
        avatar: '',
        url: 'invalid-url',
        uri: ''
      } as MastodonStatus['account']
    })

    expect(getMastodonStatusDetailPath(status)).toBe(`/@alice/${publicId}`)
  })
})

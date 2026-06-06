import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

describe('getStatusDetailPath', () => {
  it('returns a hash-based path for note status', () => {
    const url = 'https://example.com/users/alice/statuses/123'
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: 'alice',
        domain: 'example.com'
      },
      url
    } as Status

    expect(getStatusDetailPath(status)).toBe(
      `/@alice@example.com/${getHashFromString(url)}`
    )
  })

  it('returns an id-based path for remote announce status using original status', () => {
    const url = 'https://remote.example/users/bob/statuses/456'
    const id = 'https://remote.example/ap/statuses/456'
    const status = {
      type: StatusType.enum.Announce,
      originalStatus: {
        actor: {
          username: 'bob',
          domain: 'remote.example'
        },
        id,
        isLocalActor: false,
        url
      }
    } as Status

    expect(getStatusDetailPath(status)).toBe(
      `/@bob@remote.example/${encodeURIComponent(id)}`
    )
  })

  it('returns null when actor is missing', () => {
    const status = {
      type: StatusType.enum.Note,
      actor: null,
      url: 'https://example.com/users/alice/statuses/123'
    } as Status

    expect(getStatusDetailPath(status)).toBeNull()
  })
})

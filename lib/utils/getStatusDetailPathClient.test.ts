import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

describe('#getStatusDetailPathClient', () => {
  it('returns a hash-based path for note status', async () => {
    const url = 'https://example.com/users/alice/statuses/123'
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: 'alice',
        domain: 'example.com'
      },
      url
    } as Status

    expect(await getStatusDetailPathClient(status)).toBe(
      `/@alice@example.com/${await getHashFromStringClient(url)}`
    )
  })

  it('returns a hash-based path for announce status using original status', async () => {
    const url = 'https://remote.example/users/bob/statuses/456'
    const status = {
      type: StatusType.enum.Announce,
      originalStatus: {
        actor: {
          username: 'bob',
          domain: 'remote.example'
        },
        url
      }
    } as Status

    expect(await getStatusDetailPathClient(status)).toBe(
      `/@bob@remote.example/${await getHashFromStringClient(url)}`
    )
  })

  it('returns null when actor is missing', async () => {
    const status = {
      type: StatusType.enum.Note,
      actor: null,
      url: 'https://example.com/users/alice/statuses/123'
    } as Status

    expect(await getStatusDetailPathClient(status)).toBeNull()
  })
})

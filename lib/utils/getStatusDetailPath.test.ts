import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
import { generatePublicId } from '@/lib/utils/publicId'

describe('getStatusDetailPath', () => {
  it('returns a publicId path for a local note', () => {
    const publicId = generatePublicId()
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: 'alice',
        domain: 'example.com'
      },
      publicId,
      url: 'https://example.com/users/alice/statuses/123'
    } as Status

    expect(getStatusDetailPath(status)).toBe(`/@alice@example.com/${publicId}`)
  })

  it('returns the same publicId shape for a remote note, not a percent-encoded URI', () => {
    const publicId = generatePublicId()
    const id = 'https://remote.example/ap/statuses/456'
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: 'bob',
        domain: 'remote.example'
      },
      id,
      isLocalActor: false,
      publicId,
      url: 'https://remote.example/users/bob/statuses/456'
    } as Status

    const path = getStatusDetailPath(status)
    expect(path).toBe(`/@bob@remote.example/${publicId}`)
    expect(path).not.toContain(encodeURIComponent(id))
  })

  it('reads the publicId of the boosted status for an announce', () => {
    const publicId = generatePublicId()
    const status = {
      type: StatusType.enum.Announce,
      publicId: generatePublicId(),
      originalStatus: {
        actor: {
          username: 'bob',
          domain: 'remote.example'
        },
        id: 'https://remote.example/ap/statuses/456',
        isLocalActor: false,
        publicId,
        url: 'https://remote.example/users/bob/statuses/456'
      }
    } as Status

    expect(getStatusDetailPath(status)).toBe(`/@bob@remote.example/${publicId}`)
  })

  it('falls back to a hash-based path for a local note with no publicId', () => {
    const url = 'https://example.com/users/alice/statuses/123'
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: 'alice',
        domain: 'example.com'
      },
      publicId: null,
      url
    } as Status

    expect(getStatusDetailPath(status)).toBe(
      `/@alice@example.com/${getHashFromString(url)}`
    )
  })

  it('falls back to an id-based path for a remote announce with no publicId', () => {
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
        publicId: null,
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
      publicId: generatePublicId(),
      url: 'https://example.com/users/alice/statuses/123'
    } as Status

    expect(getStatusDetailPath(status)).toBeNull()
  })
})

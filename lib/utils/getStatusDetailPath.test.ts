import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'
import { generatePublicId } from '@/lib/utils/publicId'

// The server and client implementations must produce identical paths.
describe.each([
  ['getStatusDetailPath', getStatusDetailPath, getHashFromString],
  [
    'getStatusDetailPathClient',
    getStatusDetailPathClient,
    getHashFromStringClient
  ]
] as const)('%s', (_name, getPath, getHash) => {
  it('returns a publicId path for a local note', async () => {
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

    expect(await getPath(status)).toBe(`/@alice@example.com/${publicId}`)
  })

  it('returns the same publicId shape for a remote note, not a percent-encoded URI', async () => {
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

    const path = await getPath(status)
    expect(path).toBe(`/@bob@remote.example/${publicId}`)
    expect(path).not.toContain(encodeURIComponent(id))
  })

  it('reads the publicId of the boosted status for an announce', async () => {
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

    expect(await getPath(status)).toBe(`/@bob@remote.example/${publicId}`)
  })

  it('falls back to a hash-based path for a local note with no publicId', async () => {
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

    expect(await getPath(status)).toBe(
      `/@alice@example.com/${await getHash(url)}`
    )
  })

  it('falls back to an id-based path for a remote announce with no publicId', async () => {
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

    expect(await getPath(status)).toBe(
      `/@bob@remote.example/${encodeURIComponent(id)}`
    )
  })

  it('returns null when actor is missing', async () => {
    const status = {
      type: StatusType.enum.Note,
      actor: null,
      publicId: generatePublicId(),
      url: 'https://example.com/users/alice/statuses/123'
    } as Status

    expect(await getPath(status)).toBeNull()
  })

  it('percent-encodes a hostile remote username so the path stays on the status page', async () => {
    const publicId = generatePublicId()
    const status = {
      type: StatusType.enum.Note,
      actor: {
        username: '../../api/v1/x?y=#',
        domain: 'remote.example'
      },
      isLocalActor: false,
      publicId,
      url: 'https://remote.example/users/x/statuses/1'
    } as Status

    const path = await getPath(status)
    expect(path).toBe(
      `/@..%2F..%2Fapi%2Fv1%2Fx%3Fy%3D%23@remote.example/${publicId}`
    )
    // Resolved against the instance, it must still be a two-segment path.
    const resolved = new URL(path ?? '', 'https://local.test')
    expect(resolved.pathname.split('/')).toHaveLength(3)
    expect(resolved.search).toBe('')
  })
})

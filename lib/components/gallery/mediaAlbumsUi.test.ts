import {
  albumAddedMessage,
  albumRemovedMessage,
  getAlbumOptionNames,
  getAlbumsOwnerId,
  getAlbumsPillLabel
} from './mediaAlbumsUi'

const option = (
  id: string,
  title: string,
  itemCount = 1,
  visibility: 'public' | 'private' = 'public'
) => ({ id, title, visibility, itemCount })

describe('getAlbumOptionNames', () => {
  it('names each album by title, visibility and photo count', () => {
    expect(
      getAlbumOptionNames([
        option('a', 'Kruger', 14),
        option('b', 'Garden birds', 1, 'private')
      ])
    ).toEqual([
      'Kruger, public album, 14 photos',
      'Garden birds, private album, 1 photo'
    ])
  })

  it('groups thousands in the count', () => {
    expect(getAlbumOptionNames([option('a', 'Big', 1234)])).toEqual([
      'Big, public album, 1,234 photos'
    ])
  })

  it('numbers albums that would otherwise sound the same', () => {
    expect(
      getAlbumOptionNames([
        option('a', 'Kruger', 14),
        option('b', 'Kruger', 14),
        option('c', 'Kruger', 2),
        option('d', 'Kruger', 14)
      ])
    ).toEqual([
      'Kruger, public album, 14 photos, number 1',
      'Kruger, public album, 14 photos, number 2',
      'Kruger, public album, 2 photos',
      'Kruger, public album, 14 photos, number 3'
    ])
  })

  it('returns names that are all different', () => {
    const names = getAlbumOptionNames([
      option('a', 'Same'),
      option('b', 'Same'),
      option('c', 'Same', 1, 'private')
    ])
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('album wording', () => {
  it('words the pill by how many albums hold the photo', () => {
    expect(getAlbumsPillLabel(0)).toBe('Add to album')
    expect(getAlbumsPillLabel(1)).toBe('In 1 album')
    expect(getAlbumsPillLabel(3)).toBe('In 3 albums')
  })

  it('words the toast messages with the album title', () => {
    expect(albumAddedMessage('Kruger')).toBe('Added to “Kruger”')
    expect(albumRemovedMessage('Kruger')).toBe('Removed from “Kruger”')
  })
})

describe('getAlbumsOwnerId', () => {
  const status = { actorId: 'https://activities.local/users/llun' }

  it('is the viewer’s own id when they wrote the post', () => {
    expect(getAlbumsOwnerId({ id: status.actorId }, status)).toBe(
      status.actorId
    )
  })

  it('is null for somebody else’s post, and for a signed-out viewer', () => {
    expect(
      getAlbumsOwnerId({ id: 'https://activities.local/users/other' }, status)
    ).toBeNull()
    expect(getAlbumsOwnerId(null, status)).toBeNull()
    expect(getAlbumsOwnerId(undefined, status)).toBeNull()
  })
})

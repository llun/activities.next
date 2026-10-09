import {
  getGalleryAlbumPublicPath,
  getGalleryAlbumPublicUrl
} from './galleryAlbumUrls'

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://base.test')
}))

describe('getGalleryAlbumPublicPath', () => {
  it('nests the album under the actor handle', () => {
    expect(
      getGalleryAlbumPublicPath({
        username: 'ann',
        domain: 'llun.test',
        albumId: 'a1'
      })
    ).toBe('/@ann@llun.test/albums/a1')
  })

  it('encodes an id that is not path-safe', () => {
    expect(
      getGalleryAlbumPublicPath({
        username: 'ann',
        domain: 'llun.test',
        albumId: 'a/b?c#d'
      })
    ).toBe('/@ann@llun.test/albums/a%2Fb%3Fc%23d')
  })
})

describe('getGalleryAlbumPublicUrl', () => {
  it('is absolute, on the origin the actor lives at', () => {
    expect(
      getGalleryAlbumPublicUrl({
        actor: {
          id: 'https://social.example.org/users/ann',
          username: 'ann',
          domain: 'social.example.org'
        },
        albumId: 'a1'
      })
    ).toBe('https://social.example.org/@ann@social.example.org/albums/a1')
  })

  it('keeps a port in the origin', () => {
    expect(
      getGalleryAlbumPublicUrl({
        actor: {
          id: 'http://localhost:3000/users/ann',
          username: 'ann',
          domain: 'localhost:3000'
        },
        albumId: 'a1'
      })
    ).toBe('http://localhost:3000/@ann@localhost:3000/albums/a1')
  })

  it('falls back to the instance base URL when the actor id is not a URL', () => {
    expect(
      getGalleryAlbumPublicUrl({
        actor: { id: 'not a url', username: 'ann', domain: 'llun.test' },
        albumId: 'a1'
      })
    ).toBe('https://base.test/@ann@llun.test/albums/a1')
  })
})

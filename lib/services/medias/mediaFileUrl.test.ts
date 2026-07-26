import { getMediaFileUrl } from './mediaFileUrl'

describe('getMediaFileUrl', () => {
  it.each([
    {
      description: 'serves a remote host over https',
      host: 'llun.test',
      mediaPath: 'medias/2026-07-26/map.jpg',
      expected: 'https://llun.test/api/v1/files/medias/2026-07-26/map.jpg'
    },
    {
      description: 'serves localhost over http',
      host: 'localhost:3000',
      mediaPath: 'map.jpg',
      expected: 'http://localhost:3000/api/v1/files/map.jpg'
    },
    {
      description: 'serves a loopback address over http',
      host: '127.0.0.1:8080',
      mediaPath: 'map.webp',
      expected: 'http://127.0.0.1:8080/api/v1/files/map.webp'
    },
    {
      description: 'serves a bare IPv6 loopback over http',
      host: '::1',
      mediaPath: 'map.jpg',
      expected: 'http://::1/api/v1/files/map.jpg'
    },
    {
      description: 'serves a bracketed IPv6 loopback over http',
      host: '[::1]:3000',
      mediaPath: 'map.jpg',
      expected: 'http://[::1]:3000/api/v1/files/map.jpg'
    }
  ])('$description', ({ host, mediaPath, expected }) => {
    expect(getMediaFileUrl(host, mediaPath)).toBe(expected)
  })
})

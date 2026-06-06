import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'

describe('getAttachmentMediaPath', () => {
  it.each([
    {
      description: 'extracts the media path from local API URLs',
      url: 'https://example.com/api/v1/files/medias/a.webp',
      expected: 'medias/a.webp'
    },
    {
      description: 'extracts and decodes the path from generic absolute URLs',
      url: 'https://cdn.example.com/media%20files/a.webp',
      expected: 'media files/a.webp'
    },
    {
      description: 'handles relative paths and strips leading slashes',
      url: '/media/a.webp',
      expected: 'media/a.webp'
    },
    {
      description:
        'returns the undecoded fallback when decodeURIComponent throws',
      url: '/media/%E0%A4%A.webp',
      expected: 'media/%E0%A4%A.webp'
    }
  ])('$description', ({ url, expected }) => {
    expect(getAttachmentMediaPath(url)).toBe(expected)
  })
})

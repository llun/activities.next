import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'

describe('#getAttachmentMediaPath', () => {
  it('extracts media path from local API URLs', () => {
    expect(
      getAttachmentMediaPath('https://example.com/api/v1/files/medias/a.webp')
    ).toBe('medias/a.webp')
  })

  it('extracts and decodes path from generic absolute URLs', () => {
    expect(
      getAttachmentMediaPath('https://cdn.example.com/media%20files/a.webp')
    ).toBe('media files/a.webp')
  })

  it('handles relative paths and strips leading slashes', () => {
    expect(getAttachmentMediaPath('/media/a.webp')).toBe('media/a.webp')
  })

  it('returns undecoded fallback when decodeURIComponent throws', () => {
    expect(getAttachmentMediaPath('/media/%E0%A4%A.webp')).toBe(
      'media/%E0%A4%A.webp'
    )
  })
})

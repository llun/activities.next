import { uploadAttachment } from '@/lib/client'
import { resizeImage } from '@/lib/utils/resizeImage'

import { uploadProfileImage } from './uploadProfileImage'

vi.mock('@/lib/client', () => ({ uploadAttachment: vi.fn() }))
vi.mock('@/lib/utils/resizeImage', () => ({ resizeImage: vi.fn() }))

const png = (size = 1) =>
  new File([new Uint8Array(size)], 'a.png', { type: 'image/png' })

describe('uploadProfileImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resizeImage).mockImplementation(async (file) => file)
  })

  it('refuses a type other than JPEG and PNG before resizing', async () => {
    const result = await uploadProfileImage(
      new File(['x'], 'a.gif', { type: 'image/gif' }),
      1000
    )

    expect(result).toEqual({ error: 'Please select a JPEG or PNG image' })
    expect(resizeImage).not.toHaveBeenCalled()
  })

  it('checks the size of the resized file, not the original', async () => {
    vi.mocked(resizeImage).mockResolvedValue(png(10))
    vi.mocked(uploadAttachment).mockResolvedValue({ url: 'u' } as never)

    await expect(uploadProfileImage(png(5000), 100)).resolves.toEqual({
      url: 'u'
    })
    vi.mocked(resizeImage).mockResolvedValue(png(500))
    const result = await uploadProfileImage(png(5), 100)
    expect(result.error).toMatch(/^Image is too large\. Maximum size is/)
  })

  it('answers an error, never throws, when the upload fails', async () => {
    vi.mocked(uploadAttachment).mockResolvedValueOnce(null)
    await expect(uploadProfileImage(png(), 1000)).resolves.toEqual({
      error: 'Failed to upload image. Please try again.'
    })

    vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error('boom'))
    await expect(uploadProfileImage(png(), 1000)).resolves.toEqual({
      error: 'Failed to upload image. Please try again.'
    })
  })
})

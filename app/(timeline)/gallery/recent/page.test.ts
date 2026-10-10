import { permanentRedirect } from 'next/navigation'

import Page from './page'

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  })
}))

describe('/gallery/recent', () => {
  beforeEach(() => {
    vi.mocked(permanentRedirect).mockClear()
  })

  it('permanently redirects to All media', async () => {
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(permanentRedirect).toHaveBeenCalledWith('/gallery/media')
  })

  it('keeps the query string', async () => {
    await expect(
      Page({
        searchParams: Promise.resolve({ category: 'bird', show: 'hidden' })
      })
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(permanentRedirect).toHaveBeenCalledWith(
      '/gallery/media?category=bird&show=hidden'
    )
  })
})

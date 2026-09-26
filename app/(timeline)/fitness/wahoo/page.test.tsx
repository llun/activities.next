import { redirect } from 'next/navigation'

import WahooPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('Wahoo redirect page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /fitness/connections/wahoo', async () => {
    await WahooPage({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenCalledWith('/fitness/connections/wahoo')
  })

  it('preserves query parameters when redirecting', async () => {
    await WahooPage({
      searchParams: Promise.resolve({ error: 'authorization_failed' })
    })
    expect(redirect).toHaveBeenCalledWith(
      '/fitness/connections/wahoo?error=authorization_failed'
    )
  })
})

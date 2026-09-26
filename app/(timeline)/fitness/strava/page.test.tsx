import { redirect } from 'next/navigation'

import StravaPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('Strava redirect page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /fitness/connections/strava', async () => {
    await StravaPage({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenCalledWith('/fitness/connections/strava')
  })

  it('preserves query parameters when redirecting', async () => {
    await StravaPage({
      searchParams: Promise.resolve({ success: 'true', code: '123' })
    })
    expect(redirect).toHaveBeenCalledWith(
      '/fitness/connections/strava?success=true&code=123'
    )
  })
})

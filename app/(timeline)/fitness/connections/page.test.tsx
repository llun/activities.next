import { redirect } from 'next/navigation'

import ConnectionsPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}))

describe('Connections index page', () => {
  it('redirects to /fitness/connections/strava', () => {
    ConnectionsPage()
    expect(redirect).toHaveBeenCalledWith('/fitness/connections/strava')
  })
})

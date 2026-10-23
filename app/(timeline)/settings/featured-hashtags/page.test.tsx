import { redirect } from 'next/navigation'

import Page from './page'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

describe('settings/featured-hashtags page', () => {
  it('redirects to the featured hashtags section of Edit profile', () => {
    Page()

    expect(redirect).toHaveBeenCalledWith('/settings/profile#featured-hashtags')
  })
})

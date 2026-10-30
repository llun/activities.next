import { permanentRedirect } from 'next/navigation'

import Page from './page'

vi.mock('next/navigation', () => ({ permanentRedirect: vi.fn() }))

describe('settings/navigation page', () => {
  it('redirects to the sidebar settings page', () => {
    Page()

    expect(permanentRedirect).toHaveBeenCalledWith('/settings/sidebar')
  })
})

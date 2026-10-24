/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

const ACTOR = {
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  name: 'Anna',
  iconUrl: null,
  account: { id: 'acct-1', defaultActorId: null }
}

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path)
}))

describe('/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
  })
  it('shows who the settings are for, with View profile and Edit profile', async () => {
    render(await Page())

    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.getByText('@anna@llun.test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/@anna@llun.test'
    )
    const edits = screen.getAllByRole('link', { name: /Edit profile/ })
    // The desktop button and the phone list's first row.
    expect(edits).toHaveLength(2)
    for (const link of edits) {
      expect(link).toHaveAttribute('href', '/settings/profile')
    }
  })

  it('no longer holds any form: its settings moved to their own pages', async () => {
    const { container } = render(await Page())

    expect(container.querySelector('form')).toBeNull()
    expect(
      screen.queryByText('Looking for your name, bio or profile fields?')
    ).not.toBeInTheDocument()
  })

  it('redirects to /auth/signin if unauthenticated', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
    expect(redirect).toHaveBeenCalledWith('/auth/signin')
  })
})

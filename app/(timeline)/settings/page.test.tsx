/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://llun.test/users/anna',
    username: 'anna',
    domain: 'llun.test',
    name: 'Anna',
    iconUrl: null,
    account: { id: 'acct-1', defaultActorId: null }
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

describe('/settings', () => {
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
})

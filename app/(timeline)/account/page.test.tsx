/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { redirect } from 'next/navigation'

import Page from './page'

const getActorFromSession = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'user@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => getActorFromSession(...args)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  })
}))

const actorWithAccount = {
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  account: {
    id: 'acct-1',
    email: 'anna@llun.test',
    name: 'Anna Account',
    iconUrl: null
  }
}

describe('/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorFromSession.mockResolvedValue(actorWithAccount)
  })

  it('renders the identity card only', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('Anna Account')).toBeInTheDocument()
    expect(screen.getByText('anna@llun.test')).toBeInTheDocument()
    expect(document.querySelector('form')).toBeNull()
    for (const name of ['Email address', 'Account photo']) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument()
    }
  })

  it('forwards an old image-upload error to /account/email', async () => {
    await expect(
      Page({ searchParams: Promise.resolve({ error: 'Invalid image URL' }) })
    ).rejects.toThrow('redirect:/account/email?error=Invalid%20image%20URL')
    expect(redirect).toHaveBeenCalledWith(
      '/account/email?error=Invalid%20image%20URL'
    )
  })

  it('redirects signed-out visitors to sign in', async () => {
    getActorFromSession.mockResolvedValue(null)

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'redirect:/auth/signin'
    )
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Page from './page'

const getActorsForAccount = vi.fn()
const getActorFromSession = vi.fn()
const actorsSection = vi.fn((_props: unknown) => <div>actors-section</div>)

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({ getActorsForAccount }))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'user@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => getActorFromSession(...args)
}))

vi.mock('@/lib/components/settings/ActorsSection', () => ({
  ActorsSection: (props: unknown) => actorsSection(props)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  })
}))

const actor = (username: string) => ({
  id: `https://llun.test/users/${username}`,
  username,
  domain: 'llun.test',
  name: username,
  iconUrl: null
})

describe('/account/profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorFromSession.mockResolvedValue({
      ...actor('anna'),
      account: { id: 'acct-1', defaultActorId: 'https://llun.test/users/bob' }
    })
  })

  it('counts several profiles and passes them to ActorsSection', async () => {
    getActorsForAccount.mockResolvedValue([actor('anna'), actor('bob')])
    render(await Page())

    expect(
      screen.getByText(
        '2 profiles on this account. They share its email, password and security.'
      )
    ).toBeInTheDocument()
    const props = actorsSection.mock.calls[0][0] as {
      actors: { username: string }[]
      currentDefault: string
    }
    expect(props.actors.map((a) => a.username)).toEqual(['anna', 'bob'])
    expect(props.currentDefault).toBe('https://llun.test/users/bob')
  })

  it('uses the singular for one profile', async () => {
    getActorsForAccount.mockResolvedValue([actor('anna')])
    render(await Page())

    expect(screen.getByText(/^1 profile on this account\./)).toBeInTheDocument()
  })

  it('redirects signed-out visitors to sign in', async () => {
    getActorFromSession.mockResolvedValue(null)
    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
  })
})

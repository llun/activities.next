/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const mockDatabase = {}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
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
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  inboxUrl: 'https://llun.test/users/anna/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followersUrl: 'https://llun.test/users/anna/followers',
  publicKey: 'public-key',
  account: { id: 'acct-1', defaultActorId: null }
}

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/types/domain/actor', () => ({
  getActorProfile: () => ({
    username: 'anna',
    domain: 'llun.test',
    name: 'Anna',
    summary: '',
    iconUrl: null,
    headerImageUrl: null,
    manuallyApprovesFollowers: true
  })
}))

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path)
}))

describe('/settings/privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the header with Privacy and description', async () => {
    render(await Page())

    expect(
      screen.getByRole('heading', { level: 1, name: 'Privacy' })
    ).toBeVisible()
    expect(
      screen.getByText(
        'Who can follow you. Blocks, mutes and filters are next to this in the list.'
      )
    ).toBeVisible()
  })

  it('renders Followers group and Manually approve followers switch', async () => {
    render(await Page())

    const group = screen.getByRole('group', { name: 'Followers' })
    expect(group).toHaveTextContent('Control who can follow you.')
    expect(
      within(group).getByLabelText('Manually approve followers')
    ).toBeInTheDocument()
  })

  it('has hidden returnTo="/settings/privacy" and marker, no postLineLimit field', async () => {
    render(await Page())

    const switchInput = screen.getByLabelText('Manually approve followers')
    const form = switchInput.closest('form') as HTMLFormElement
    expect(form).toHaveAttribute('action', '/api/v1/accounts/profile')
    const formData = new FormData(form)
    expect(formData.get('returnTo')).toBe('/settings/privacy')
    expect(formData.get('manuallyApprovesFollowers_marker')).toBe('true')
    expect(formData.get('postLineLimit')).toBeNull()
  })

  it('links to Fitness and Gallery privacy', async () => {
    render(await Page())

    const fitnessLink = screen.getByRole('link', { name: /Fitness privacy/ })
    expect(fitnessLink).toHaveAttribute('href', '/fitness/privacy')

    const galleryLink = screen.getByRole('link', { name: /Gallery privacy/ })
    expect(galleryLink).toHaveAttribute('href', '/gallery/privacy')
  })

  it('redirects to /auth/signin if unauthenticated', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
  })
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const getActorSettings = vi.fn()
const mockDatabase = { getActorSettings }

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

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path)
}))

vi.mock('@/lib/components/theme', () => ({
  ThemeControl: () => <div data-testid="theme-control" />
}))

describe('/settings/appearance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
  })

  it('renders the post line limit as the shared Select, labelled and named as before', async () => {
    getActorSettings.mockResolvedValue({ postLineLimit: 10 })

    render(await Page())

    const select = screen.getByLabelText('Post line limit')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveAttribute('data-slot', 'select')
    expect(select).toHaveAttribute('id', 'postLineLimitInput')
    expect(select).toHaveAttribute('name', 'postLineLimit')
    expect(select).toHaveValue('10')
    expect(
      screen
        .getAllByRole('option')
        .map((option) => [option.getAttribute('value'), option.textContent])
    ).toEqual([
      ['5', '5 lines'],
      ['10', '10 lines'],
      ['0', 'No limit']
    ])
  })

  it('posts postLineLimit defaulting to 5', async () => {
    getActorSettings.mockResolvedValue(null)

    render(await Page())

    const select = screen.getByLabelText('Post line limit') as HTMLSelectElement
    expect(select).toHaveValue('5')
    const form = select.form as HTMLFormElement
    expect(form).toHaveAttribute('action', '/api/v1/accounts/profile')
    expect(new FormData(form).get('postLineLimit')).toBe('5')
  })

  it('keeps the "No limit" choice posting 0', async () => {
    getActorSettings.mockResolvedValue({ postLineLimit: 0 })

    render(await Page())

    const select = screen.getByLabelText('Post line limit') as HTMLSelectElement
    expect(select).toHaveValue('0')
    expect(
      new FormData(select.form as HTMLFormElement).get('postLineLimit')
    ).toBe('0')
  })

  it('puts the post line limit in the form box under a Timeline group, and the theme outside the form', async () => {
    getActorSettings.mockResolvedValue(null)

    render(await Page())

    const timeline = screen.getByRole('group', { name: 'Timeline' })
    expect(timeline).toHaveTextContent('How posts appear on your timeline.')
    expect(timeline).toContainElement(screen.getByLabelText('Post line limit'))
    const form = (screen.getByLabelText('Post line limit') as HTMLSelectElement)
      .form as HTMLFormElement
    expect(form).not.toContainElement(screen.getByTestId('theme-control'))
  })

  it('includes hidden input returnTo="/settings/appearance" and no manuallyApprovesFollowers field', async () => {
    getActorSettings.mockResolvedValue(null)

    render(await Page())

    const form = (screen.getByLabelText('Post line limit') as HTMLSelectElement)
      .form as HTMLFormElement
    const formData = new FormData(form)
    expect(formData.get('returnTo')).toBe('/settings/appearance')
    expect(formData.get('manuallyApprovesFollowers')).toBeNull()
    expect(formData.get('manuallyApprovesFollowers_marker')).toBeNull()
  })

  it('redirects to /auth/signin if unauthenticated', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
  })
})

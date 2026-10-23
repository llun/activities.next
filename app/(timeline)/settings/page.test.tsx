/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import Page from './page'

const getActorSettings = vi.fn()
const getActorsForAccount = vi.fn()
const mockDatabase = { getActorSettings, getActorsForAccount }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
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
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    inboxUrl: 'https://llun.test/users/anna/inbox',
    sharedInboxUrl: 'https://llun.test/inbox',
    followersUrl: 'https://llun.test/users/anna/followers',
    publicKey: 'public-key',
    account: { id: 'acct-1', defaultActorId: null }
  })
}))

vi.mock('@/lib/types/domain/actor', () => ({
  getActorProfile: () => ({
    username: 'anna',
    domain: 'llun.test',
    name: 'Anna',
    summary: '',
    iconUrl: null,
    headerImageUrl: null,
    manuallyApprovesFollowers: false
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

// Client pieces that are not under test here.
vi.mock('@/lib/components/theme', () => ({
  ThemeControl: () => <div data-testid="theme-control" />
}))
vi.mock('@/lib/components/settings/DeleteActorSection', () => ({
  DeleteActorSection: () => <div data-testid="delete-actor" />
}))

describe('/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActorsForAccount.mockResolvedValue([])
    // The Switch in the Privacy card measures itself with a ResizeObserver,
    // which jsdom lacks.
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

  it('posts postLineLimit with the profile form, defaulting to 5 lines', async () => {
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
    expect(form).not.toContainElement(
      screen.getByRole('heading', { name: 'Appearance' })
    )
  })

  describe('the profile moved to Edit profile', () => {
    it('sends only the timeline and privacy settings with the form, never a name, bio, image or link', async () => {
      getActorSettings.mockResolvedValue({
        postLineLimit: 10,
        fields: [{ name: 'Blog', value: 'https://blog.example' }]
      })

      render(await Page())

      const form = (
        screen.getByLabelText('Post line limit') as HTMLSelectElement
      ).form as HTMLFormElement
      expect(form).toHaveAttribute('action', '/api/v1/accounts/profile')
      expect([...new FormData(form).keys()].sort()).toEqual([
        'manuallyApprovesFollowers_marker',
        'postLineLimit'
      ])
    })

    it('has no name, summary, handle, image or profile field controls any more', async () => {
      getActorSettings.mockResolvedValue({
        fields: [{ name: 'Blog', value: 'https://blog.example' }]
      })

      render(await Page())

      expect(screen.queryByLabelText('Name')).toBeNull()
      expect(screen.queryByLabelText('Summary')).toBeNull()
      expect(screen.queryByLabelText('Handle')).toBeNull()
      expect(screen.queryByLabelText('Field 1 label')).toBeNull()
      expect(screen.queryByText('Icon image')).toBeNull()
      expect(screen.queryByText('Header image')).toBeNull()
      expect(screen.queryByRole('group', { name: 'Profile' })).toBeNull()
    })

    it('keeps Appearance, Timeline, Privacy and the Danger zone', async () => {
      getActorSettings.mockResolvedValue(null)

      render(await Page())

      expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible()
      expect(screen.getByRole('group', { name: 'Timeline' })).toBeVisible()
      expect(screen.getByRole('group', { name: 'Privacy' })).toBeVisible()
      expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeVisible()
      expect(
        screen.getByText('Appearance, timeline and who can follow you.')
      ).toBeVisible()
    })

    it('points to Edit profile in an Alert card outside the form box', async () => {
      getActorSettings.mockResolvedValue(null)

      render(await Page())

      const callout = screen
        .getByText('Looking for your name, bio or profile fields?')
        .closest('[data-slot="alert"]') as HTMLElement
      expect(callout).not.toBeNull()
      expect(callout).toHaveTextContent(
        'They moved to Edit profile, together with featured hashtags.'
      )
      expect(callout.closest('[data-slot="frame"]')).toBeNull()
      expect(
        within(callout).getByRole('link', { name: 'Edit profile' })
      ).toHaveAttribute('href', '/settings/profile')
      // It is page content at load, not news to announce.
      expect(callout).not.toHaveAttribute('role')
    })
  })
})

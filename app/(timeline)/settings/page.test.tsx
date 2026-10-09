/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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
vi.mock('@/lib/components/settings/ImageUploadField', () => ({
  ImageUploadField: () => <div data-testid="image-upload" />
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
})

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

  describe('profile links', () => {
    it('puts the row after Summary and before the image uploads, inside the profile form', async () => {
      getActorSettings.mockResolvedValue(null)

      render(await Page())

      const profile = screen.getByRole('group', { name: 'Profile' })
      const summary = screen.getByLabelText('Summary')
      const links = screen.getByLabelText('Link 1 label')
      const upload = screen.getAllByTestId('image-upload')[0]
      expect(profile).toContainElement(links)
      expect(
        summary.compareDocumentPosition(links) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        links.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        (links as HTMLInputElement).form ===
          (summary as HTMLTextAreaElement).form
      ).toBe(true)
      expect(
        screen.getByText(
          'Up to 4. Shown on your profile and on other servers. Plain text works too.'
        )
      ).toBeInTheDocument()
    })

    it('posts the saved fields with the profile form', async () => {
      getActorSettings.mockResolvedValue({
        fields: [{ name: 'Blog', value: 'https://blog.example' }]
      })

      render(await Page())

      const form = (screen.getByLabelText('Summary') as HTMLTextAreaElement)
        .form as HTMLFormElement
      const data = new FormData(form)
      expect(data.get('fields[0][name]')).toBe('Blog')
      expect(data.get('fields[0][value]')).toBe('https://blog.example')
      expect(data.get('fields[3][name]')).toBe('')
    })

    it('shows each saved link\u2019s verification next to its inputs', async () => {
      getActorSettings.mockResolvedValue({
        fields: [
          {
            name: 'Blog',
            value: 'https://blog.example',
            verifiedAt: 1700000000000
          },
          { name: 'Site', value: 'https://site.example' },
          { name: 'Pronouns', value: 'they/them' }
        ]
      })

      render(await Page())

      expect(screen.getAllByText('Verified')).toHaveLength(1)
      expect(screen.getAllByText('Not verified')).toHaveLength(1)
    })

    it('shows the rel me snippet with the real profile URL', async () => {
      getActorSettings.mockResolvedValue(null)

      render(await Page())

      expect(
        screen.getByText(
          '<a rel="me" href="https://llun.test/@anna">Activities.next</a>'
        ).tagName
      ).toBe('CODE')
    })
  })
})

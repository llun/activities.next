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

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path)
}))

const editorProps = vi.fn()
vi.mock('@/lib/components/settings/profile/ProfileEditor', () => ({
  ProfileEditor: (props: Record<string, unknown>) => {
    editorProps(props)
    return <div data-testid="profile-editor" />
  }
}))

const ACTOR = {
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  name: 'Anna',
  summary: 'Bio',
  iconUrl: 'https://llun.test/api/v1/files/a.jpg',
  headerImageUrl: '',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  inboxUrl: 'https://llun.test/users/anna/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followersUrl: 'https://llun.test/users/anna/followers',
  publicKey: 'public-key',
  showFitness: false,
  account: { id: 'acct-1', defaultActorId: null }
}

describe('/settings/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
    getActorSettings.mockResolvedValue({
      avatarDescription: 'A smiling woman',
      fields: [
        {
          name: 'Website',
          value: 'https://anna.example',
          verifiedAt: Date.UTC(2026, 9, 1)
        }
      ]
    })
  })

  it('redirects a signed-out visitor to sign in', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page({})).rejects.toThrow('redirect:/auth/signin')
  })

  it('hands the editor the saved profile in the shape a save answers with', async () => {
    render(await Page({}))

    expect(screen.getByTestId('profile-editor')).toBeInTheDocument()
    expect(editorProps).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'anna',
        handle: '@anna@llun.test',
        profileUrl: 'https://llun.test/@anna',
        profilePath: '/@anna@llun.test',
        profile: {
          name: 'Anna',
          summary: 'Bio',
          fields: [
            {
              name: 'Website',
              value: 'https://anna.example',
              verifiedAt: '2026-10-01T00:00:00.000Z'
            }
          ],
          iconUrl: 'https://llun.test/api/v1/files/a.jpg',
          headerImageUrl: null,
          avatarDescription: 'A smiling woman',
          headerDescription: '',
          showReplies: true,
          showMedia: true,
          showGallery: true,
          showFitness: false
        }
      })
    )
  })

  it('works for an actor with no settings row', async () => {
    getActorSettings.mockResolvedValue(null)

    render(await Page({}))

    expect(editorProps.mock.calls[0][0].profile).toEqual(
      expect.objectContaining({ fields: [], avatarDescription: '' })
    )
  })

  it('shows no switch notice by default or for another value', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByText(/Switched to/)).toBeNull()

    render(await Page({ searchParams: Promise.resolve({ switched: '0' }) }))
    expect(screen.queryByText(/Switched to/)).toBeNull()
  })

  it('shows the switch notice as a standalone info Alert for ?switched=1', async () => {
    render(await Page({ searchParams: Promise.resolve({ switched: '1' }) }))

    const alert = screen
      .getByText('Switched to @anna@llun.test.')
      .closest('[data-slot="alert"]') as HTMLElement
    expect(alert).toHaveTextContent(
      'Switched to @anna@llun.test.You’re now posting as this profile.'
    )
    expect(alert).toHaveAttribute('role', 'status')
    expect(alert.closest('[data-slot="frame"]')).toBeNull()
    // It sits before the editor, in the page stack.
    expect(
      alert.compareDocumentPosition(screen.getByTestId('profile-editor')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

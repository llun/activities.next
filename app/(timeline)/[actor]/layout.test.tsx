/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

const { mockGetActorFromUsername, mockHeaders, mockPermanentRedirect } =
  vi.hoisted(() => ({
    mockGetActorFromUsername: vi.fn(),
    mockHeaders: vi.fn(),
    mockPermanentRedirect: vi.fn()
  }))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({
    getActorFromUsername: mockGetActorFromUsername
  }))
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders()
}))

vi.mock('next/navigation', () => ({
  permanentRedirect: (path: string) => mockPermanentRedirect(path)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/app/(timeline)/PublicShell', () => ({
  PublicShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="public-shell">{children}</div>
  )
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const renderLayout = async (actor = '@alice@old.example') => {
  const element = await Layout({
    children: <div data-testid="child" />,
    params: Promise.resolve({ actor })
  })
  render(element)
}

describe('[actor] Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActorFromUsername.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(new Headers())
    mockPermanentRedirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`)
    })
    mockGetServerAuthSession.mockResolvedValue(null)
  })

  it('wraps children in the public shell for logged-out visitors', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.getByTestId('public-shell')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('passes children through for signed-in users', async () => {
    mockGetActorFromSession.mockResolvedValue({ id: 'actor-1' } as never)

    await renderLayout()

    expect(screen.queryByTestId('public-shell')).not.toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it.each([
    {
      path: '/@alice@old.example',
      target: '/@new-name@new.example'
    },
    {
      path: '/@alice@old.example/123',
      target: '/@new-name@new.example/123'
    },
    {
      path: '/@alice@old.example/followers',
      target: '/@new-name@new.example/followers'
    },
    {
      path: '/@alice@old.example/following',
      target: '/@new-name@new.example/following'
    },
    {
      path: '/@alice@old.example/albums/album-1',
      target: '/@new-name@new.example/albums/album-1'
    }
  ])(
    'permanently redirects renamed profile page $path before rendering',
    async ({ path, target }) => {
      mockGetActorFromUsername.mockResolvedValue({
        id: 'https://old.example/users/alice',
        username: 'new-name',
        domain: 'new.example',
        privateKey: 'private-key',
        account: { id: 'account-id' }
      } as never)
      mockHeaders.mockResolvedValue(
        new Headers({
          'x-activities-local-handle-path': path,
          'x-activities-local-handle-search': '?tab=photos'
        })
      )

      const redirectTarget = `${target}?tab=photos`
      await expect(renderLayout('@alice@old.example')).rejects.toThrow(
        `redirect:${redirectTarget}`
      )

      expect(mockPermanentRedirect).toHaveBeenCalledWith(redirectTarget)
      expect(mockGetServerAuthSession).not.toHaveBeenCalled()
    }
  )
})

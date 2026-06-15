/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
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

const renderLayout = async () => {
  const element = await Layout({ children: <div data-testid="child" /> })
  render(element)
}

describe('[actor] Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})

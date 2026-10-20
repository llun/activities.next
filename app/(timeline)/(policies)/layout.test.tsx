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
  PublicShell: ({
    children,
    footer = true
  }: {
    children: React.ReactNode
    footer?: boolean
  }) => (
    <div data-testid="public-shell" data-footer={String(footer)}>
      {children}
    </div>
  )
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const renderLayout = async () => {
  render(await Layout({ children: <div data-testid="child" /> }))
}

describe('(policies) Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
  })

  it('wraps the policy pages in the public shell for logged-out visitors', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.getByTestId('public-shell')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it("leaves out the shell's footer, since the page prints its own", async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    await renderLayout()

    expect(screen.getByTestId('public-shell')).toHaveAttribute(
      'data-footer',
      'false'
    )
  })

  it('passes children through for signed-in users, with top spacing', async () => {
    mockGetActorFromSession.mockResolvedValue({ id: 'actor-1' } as never)

    await renderLayout()

    expect(screen.getByTestId('child').parentElement).toHaveClass(
      'pt-6',
      'md:pt-8'
    )
    expect(screen.queryByTestId('public-shell')).not.toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})

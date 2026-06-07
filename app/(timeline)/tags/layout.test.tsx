/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn(() => ({}))
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

jest.mock('@/app/(timeline)/PublicShell', () => ({
  PublicShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="public-shell">{children}</div>
  )
}))

const mockGetServerAuthSession = jest.mocked(getServerAuthSession)
const mockGetActorFromSession = jest.mocked(getActorFromSession)

const renderLayout = async () => {
  const element = await Layout({ children: <div data-testid="child" /> })
  render(element)
}

describe('tags Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

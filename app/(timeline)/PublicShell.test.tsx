/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import { PublicShell } from './PublicShell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/tags/fediverse'
}))

vi.mock('@/app/Modal', () => ({
  Modal: () => null
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

const mockSettings = vi.mocked(getResolvedServerSettings)

const renderShell = async (registrationOpen: boolean) => {
  mockSettings.mockResolvedValue({
    registrations: { open: registrationOpen }
  } as Awaited<ReturnType<typeof getResolvedServerSettings>>)
  render(
    await PublicShell({
      children: <MobileNavigationTrigger data-testid="page-trigger" />
    })
  )
}

describe('PublicShell', () => {
  beforeEach(() => {
    mockSettings.mockReset()
  })

  it('hides the desktop top bar below md and lets pages open the public drawer', async () => {
    await renderShell(true)

    expect(screen.getByRole('banner')).toHaveClass('max-md:hidden')

    // A page's own trigger works because the shell provides the drawer.
    fireEvent.click(screen.getByTestId('page-trigger'))
    const drawer = screen.getByRole('dialog')
    expect(
      within(drawer).getByRole('link', { name: 'Create account' })
    ).toBeInTheDocument()
  })

  it('applies closed registration to both the top bar and the drawer', async () => {
    await renderShell(false)

    expect(
      within(screen.getByRole('banner')).queryByRole('link', {
        name: 'Create account'
      })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('page-trigger'))
    expect(
      within(screen.getByRole('dialog')).queryByRole('link', {
        name: 'Create account'
      })
    ).not.toBeInTheDocument()
  })

  it('drops the reading column top padding only below md', async () => {
    await renderShell(true)

    const column = screen.getByTestId('page-trigger').parentElement
    expect(column).toHaveClass('py-6', 'max-md:pt-0')
  })
})

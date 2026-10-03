/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { getPasskeys } from '@/lib/client'
import { authClient } from '@/lib/services/auth/auth-client'

import { PasskeyManager } from './PasskeyManager'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('')
}))

vi.mock('@/lib/client', () => ({
  getPasskeys: vi.fn()
}))

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: {
    passkey: {
      addPasskey: vi.fn(),
      deletePasskey: vi.fn()
    }
  }
}))

const mockGetPasskeys = getPasskeys as jest.Mock
const mockAddPasskey = authClient.passkey.addPasskey as jest.Mock

const MULTI_DOMAINS = [
  { domain: 'llun.social', primary: true },
  { domain: 'llun.photos', primary: false }
]

describe('PasskeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a domain pill and Primary badge per passkey when multi-domain', async () => {
    mockGetPasskeys.mockResolvedValue([
      {
        id: 'pk1',
        name: 'MacBook',
        domain: 'llun.social',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        aaguid: null
      }
    ])

    render(
      <PasskeyManager
        domains={MULTI_DOMAINS}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    expect(await screen.findByText('MacBook')).toBeInTheDocument()
    expect(screen.getByText('llun.social')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('draws the domain pill as the shared gray Badge, like the Primary badge beside it', async () => {
    mockGetPasskeys.mockResolvedValue([
      {
        id: 'pk1',
        name: 'MacBook',
        domain: 'llun.social',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        aaguid: null
      }
    ])

    render(
      <PasskeyManager
        domains={MULTI_DOMAINS}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    await screen.findByText('MacBook')
    const pill = screen.getByText('llun.social')
    expect(pill).toHaveClass('bg-muted', 'text-muted-foreground')
    // The design's dark gray: without it the pill sat a shade off the Primary
    // badge next to it on a dark card.
    expect(pill.className).toContain('dark:bg-[#383838]')
    expect(pill.className).toContain('dark:text-[#C2C2C2]')
  })

  it('shows the domain chooser in the add dialog when multi-domain', async () => {
    mockGetPasskeys.mockResolvedValue([])

    render(
      <PasskeyManager
        domains={MULTI_DOMAINS}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    await waitFor(() =>
      expect(
        screen.getByText('No passkeys registered yet.')
      ).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /add passkey/i }))

    expect(await screen.findByText('Add a passkey')).toBeInTheDocument()
    expect(screen.getByText('Domain')).toBeInTheDocument()
    expect(screen.getByText('anna@llun.photos')).toBeInTheDocument()
  })

  it('omits domain pills and the chooser for a single-domain instance', async () => {
    mockGetPasskeys.mockResolvedValue([
      {
        id: 'pk1',
        name: 'MacBook',
        domain: 'llun.social',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        aaguid: null
      }
    ])

    render(
      <PasskeyManager
        domains={[{ domain: 'llun.social', primary: true }]}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    expect(await screen.findByText('MacBook')).toBeInTheDocument()
    // No domain pill / Primary badge in single-domain mode.
    expect(screen.queryByText('llun.social')).not.toBeInTheDocument()
    expect(screen.queryByText('Primary')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add passkey/i }))
    expect(await screen.findByText('Add a passkey')).toBeInTheDocument()
    expect(screen.queryByText('Domain')).not.toBeInTheDocument()
  })

  it('draws the add dialog title on a 16 px line so the description sits right under it', async () => {
    mockGetPasskeys.mockResolvedValue([])

    render(
      <PasskeyManager
        domains={[{ domain: 'llun.social', primary: true }]}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: /add passkey/i }))
    const title = await screen.findByText('Add a passkey')
    // `text-base` alone would bring a 24 px line height (class merging drops
    // the DialogTitle's own leading-none), pushing the header 8 px taller.
    expect(title).toHaveClass('text-base', 'leading-none')
  })

  it('shows a creation failure inside the still-open dialog', async () => {
    mockGetPasskeys.mockResolvedValue([])
    mockAddPasskey.mockResolvedValue({
      error: { message: 'Passkey already registered' }
    })

    render(
      <PasskeyManager
        domains={[{ domain: 'llun.social', primary: true }]}
        currentDomain="llun.social"
        handlePrefix="anna"
      />
    )

    await waitFor(() =>
      expect(
        screen.getByText('No passkeys registered yet.')
      ).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /add passkey/i }))
    fireEvent.click(
      await screen.findByRole('button', { name: /create passkey/i })
    )

    // Error surfaces inside the still-open dialog (the page-level copy sits
    // behind the modal overlay).
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        within(dialog).getByText('Passkey already registered')
      ).toBeInTheDocument()
    )
    expect(within(dialog).getByText('Add a passkey')).toBeInTheDocument()
  })
})

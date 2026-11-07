/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { updateBlueskySharing } from '@/lib/client'
import type { BlueskySharingState } from '@/lib/utils/blueskySharing'

import { BlueskySharingForm } from './BlueskySharingForm'

vi.mock('@/lib/client', () => ({ updateBlueskySharing: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const initialState: BlueskySharingState = {
  status: 'Off',
  handle: 'alice.personal.example.ap.brid.gy',
  requirements: [],
  federationAllowed: true
}
const show = (state: Partial<BlueskySharingState> = {}) =>
  render(<BlueskySharingForm initialState={{ ...initialState, ...state }} />)

describe('BlueskySharingForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('turns sharing on and shows setup status after saving', async () => {
    vi.mocked(updateBlueskySharing).mockResolvedValue({
      ...initialState,
      status: 'Setting up'
    })
    show()
    expect(screen.getByText('Off')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('switch', { name: 'Share my posts on Bluesky' })
    )
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    expect(updateBlueskySharing).toHaveBeenCalledWith(true)
    expect(screen.getByText('Setting up')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('links the handle when sharing is on', () => {
    show({ status: 'On' })
    expect(
      screen.getByRole('link', { name: initialState.handle })
    ).toHaveAttribute('href', `https://bsky.app/profile/${initialState.handle}`)
    expect(screen.getByRole('switch')).toBeChecked()
  })

  it('requires confirmation before turning off, and allows cancellation', async () => {
    vi.mocked(updateBlueskySharing).mockResolvedValue(initialState)
    show({ status: 'On' })
    fireEvent.click(screen.getByRole('switch'))
    expect(
      screen.getByText('Your Bluesky copy and its followers will be removed.')
    ).toBeInTheDocument()
    expect(updateBlueskySharing).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(updateBlueskySharing).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    expect(updateBlueskySharing).toHaveBeenCalledWith(false)
  })

  it.each([
    'Add a profile picture.',
    'Set a display name that differs from your username.',
    'Your username cannot be bridged.'
  ])('disables enabling for a missing requirement: %s', (reason) => {
    show({ requirements: [reason] })
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(
      expect.stringContaining(reason)
    )
    expect(screen.getByText('Requirements')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Bridgy Fed requirements' })
    ).toHaveAttribute('href', 'https://fed.brid.gy/docs')
  })

  it('disables enabling when the instance blocks federation', () => {
    show({ federationAllowed: false })
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(
      expect.stringContaining('does not federate')
    )
  })

  it.each(['On', 'Setting up'] as const)(
    'allows turning %s off after requirements and policy become unmet',
    (status) => {
      show({
        status,
        requirements: ['Add a profile picture.'],
        federationAllowed: false
      })
      expect(screen.getByRole('switch')).not.toBeDisabled()
      fireEvent.click(screen.getByRole('switch'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }
  )

  it('shows a failed save inline and keeps the previous choice', async () => {
    vi.mocked(updateBlueskySharing).mockRejectedValue(
      new Error('Bridge unreachable.')
    )
    show()
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bridge unreachable.'
    )
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.getByRole('switch')).not.toBeDisabled()
  })

  it('disables the switch while a save is pending', async () => {
    let finish!: (state: BlueskySharingState) => void
    vi.mocked(updateBlueskySharing).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    show()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeDisabled()
    finish({ ...initialState, status: 'Setting up' })
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
  })
})

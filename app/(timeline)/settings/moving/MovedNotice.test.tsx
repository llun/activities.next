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

import * as client from '@/lib/client'

import { MovedNotice } from './MovedNotice'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refresh })
}))

vi.mock('@/lib/client', () => ({
  cancelAccountRedirect: vi.fn()
}))

const mockCancel = vi.mocked(client.cancelAccountRedirect)

describe('MovedNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers Cancel redirect for a redirect, behind a confirm dialog', async () => {
    mockCancel.mockResolvedValueOnce({
      movedTo: null,
      migrations: [],
      cooldownUntil: null,
      followersCount: 12
    })

    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="redirect"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil={null}
      />
    )

    expect(screen.getByText('This profile has moved to')).toBeInTheDocument()
    expect(screen.getByText('@may@new.example')).toBeInTheDocument()
    expect(screen.getByText('24 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText(/your profile shows/)).toBeInTheDocument()
    expect(
      screen.getByText(/Your followers have not been moved/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel redirect' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel redirect'
    })
    expect(
      within(dialog).getByText(/Your profile will stop showing that it moved/)
    ).toBeInTheDocument()
    expect(mockCancel).not.toHaveBeenCalled()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel redirect' })
    )

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna'
      })
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('has no action after a full move, only the cooldown date', () => {
    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="move"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil="2026-11-23T00:00:00.000Z"
      />
    )

    expect(screen.getByText('You moved to')).toBeInTheDocument()
    expect(screen.getByText(/Your followers moved too/)).toBeInTheDocument()
    expect(screen.getByText(/You can move again on/)).toBeInTheDocument()
    expect(screen.getByText('23 Nov 2026')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel redirect' })
    ).not.toBeInTheDocument()
  })
})

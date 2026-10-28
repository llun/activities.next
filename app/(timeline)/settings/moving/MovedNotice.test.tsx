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
import { requestMovingFocus, takeMovingFocus } from './movingFocus'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refresh })
}))

const connection = {
  state: 'online' as 'online' | 'offline' | 'unreachable'
}

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => connection
}))

vi.mock('@/lib/client', () => {
  class ApiRequestError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiRequestError'
      this.status = status
    }
  }
  return {
    ApiRequestError,
    cancelAccountRedirect: vi.fn()
  }
})

const mockCancel = vi.mocked(client.cancelAccountRedirect)

describe('MovedNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.state = 'online'
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

  it('leaves a focus request for the form after cancelling a redirect', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Cancel redirect' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel redirect'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel redirect' })
    )

    await waitFor(() => {
      // The refresh swaps this notice for the MoveForm, which takes the
      // request on mount and focuses its own warning.
      expect(takeMovingFocus('move-form')).toBe(true)
    })
  })

  it('takes the focus request left by a move', () => {
    requestMovingFocus('moved-notice')

    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="move"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil="2026-11-23T00:00:00.000Z"
      />
    )

    expect(document.activeElement).toBe(
      screen.getByText('You moved to').closest('[tabindex="-1"]')
    )
  })

  it('leaves focus alone on a plain page load', () => {
    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="move"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil="2026-11-23T00:00:00.000Z"
      />
    )

    expect(document.activeElement).toBe(document.body)
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

  it('shows the actor-changed alert when cancelling hits 409 Actor changed', async () => {
    mockCancel.mockRejectedValueOnce(
      new client.ApiRequestError('Actor changed', 409)
    )

    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="redirect"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel redirect' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel redirect'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel redirect' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('Your active profile changed')
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // The raw message is not shown as the error Alert.
    expect(
      screen.queryByText((_, element) =>
        element?.getAttribute('data-slot') === 'alert'
          ? element.textContent === 'Actor changed'
          : false
      )
    ).toBeNull()
  })

  it('disables Cancel redirect while offline, with a note', () => {
    connection.state = 'offline'
    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="redirect"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil={null}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Cancel redirect' })
    ).toBeDisabled()
    expect(screen.getByText("You're offline")).toBeInTheDocument()
  })

  it('keeps Cancel redirect available while the server is unreachable', () => {
    // `unreachable` is the health probe failing while the device is online:
    // only the browser's own `offline` state disables the action, so it keeps
    // its own error path.
    connection.state = 'unreachable'
    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="redirect"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil={null}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Cancel redirect' })
    ).not.toBeDisabled()
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument()
  })

  it('maps a network failure to the plain message, not the browser text', async () => {
    mockCancel.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(
      <MovedNotice
        actorId="https://llun.test/users/anna"
        acct="may@new.example"
        kind="redirect"
        movedAt="2026-10-24T00:00:00.000Z"
        cooldownUntil={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel redirect' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel redirect'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel redirect' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('Could not cancel the redirect')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})

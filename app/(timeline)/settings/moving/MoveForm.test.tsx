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

import { MoveForm } from './MoveForm'
import { requestMovingFocus, takeMovingFocus } from './movingFocus'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
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
    getAccountMigration: vi.fn(),
    moveAccount: vi.fn()
  }
})

const mockMove = vi.mocked(client.moveAccount)
const mockGetMigration = vi.mocked(client.getAccountMigration)

const fillMove = () => {
  fireEvent.change(screen.getByLabelText('New account'), {
    target: { value: '@may@new.example' }
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'secret' }
  })
}

describe('MoveForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // RadioGroup measures its cards; jsdom has no observer.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the standing warning', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    expect(
      screen.getByText('Followers move. Posts stay here.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Your posts, photos and fitness files stay on this/)
    ).toBeInTheDocument()
  })

  it('offers the two kinds and words the action per kind', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    expect(
      screen.getByRole('radio', { name: /Move my followers/ })
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: /Only show a redirect/ })
    ).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Move followers' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Only show a redirect/ }))

    expect(
      screen.getByRole('button', { name: 'Show redirect' })
    ).toBeInTheDocument()
  })

  it('confirms a full move before sending it', async () => {
    mockMove.mockResolvedValueOnce({
      movedTo: { id: 'https://new.example/users/may', acct: 'may@new.example' },
      migrations: [],
      cooldownUntil: null,
      followersCount: 12
    })

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    expect(
      within(dialog).getByText(/followers will be moved to/)
    ).toBeInTheDocument()
    expect(within(dialog).getByText('@may@new.example')).toBeInTheDocument()
    expect(mockMove).not.toHaveBeenCalled()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(mockMove).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        acct: 'may@new.example',
        kind: 'move',
        password: 'secret'
      })
    })
  })

  it('confirms a redirect with its own words', async () => {
    mockMove.mockResolvedValueOnce({
      movedTo: { id: 'https://new.example/users/may', acct: 'may@new.example' },
      migrations: [],
      cooldownUntil: null,
      followersCount: 12
    })

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: /Only show a redirect/ }))
    fireEvent.change(screen.getByLabelText('New account'), {
      target: { value: '@may@new.example' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show redirect' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Show a redirect'
    })
    expect(
      within(dialog).getByText(/profile will show that you moved to/)
    ).toBeInTheDocument()
    expect(within(dialog).getByText('@may@new.example')).toBeInTheDocument()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Show redirect' })
    )

    await waitFor(() => {
      expect(mockMove).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        acct: 'may@new.example',
        kind: 'redirect',
        password: 'secret'
      })
    })
  })

  it('asks for the current username on a passwordless account', async () => {
    mockMove.mockResolvedValueOnce({
      movedTo: null,
      migrations: [],
      cooldownUntil: null,
      followersCount: 12
    })

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword={false}
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New account'), {
      target: { value: '@may@new.example' }
    })
    fireEvent.change(screen.getByLabelText('Current username'), {
      target: { value: 'anna' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(mockMove).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        acct: 'may@new.example',
        kind: 'move',
        username: 'anna'
      })
    })
  })

  it('maps the alias-required failure to the field error', async () => {
    mockMove.mockRejectedValueOnce(
      new client.ApiRequestError(
        'Add this account as an alias on the new account first',
        422
      )
    )

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          '@may@new.example does not list @anna@llun.test as an old account yet. Add it there first, then try again.'
        )
      ).toBeInTheDocument()
    })
  })

  it('keeps the action off while the cooldown runs', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil="2026-11-23T00:00:00.000Z"
      />
    )

    expect(screen.getByText(/You can move again on/)).toBeInTheDocument()
    expect(screen.getByText('23 Nov 2026')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move followers' })
    ).toBeDisabled()
  })

  it('keeps a redirect available while the move cooldown runs', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil="2026-11-23T00:00:00.000Z"
      />
    )

    // The redirect's own note shows, not the move's cooldown date.
    fireEvent.click(screen.getByRole('radio', { name: /Only show a redirect/ }))
    expect(
      screen.getByText('No time limit. Cancel any time.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/You can move again on/)).not.toBeInTheDocument()

    // A filled form can still send a redirect, while the move stays off.
    fillMove()
    fireEvent.click(screen.getByRole('radio', { name: /Move my followers/ }))
    expect(
      screen.getByRole('button', { name: 'Move followers' })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Only show a redirect/ }))
    expect(
      screen.getByRole('button', { name: 'Show redirect' })
    ).not.toBeDisabled()
  })

  it('draws no native radio inputs named by their value', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    // The only radios are the RadioCards' own, named by their titles; the
    // hidden native inputs Radix draws for radios inside a <form> would be
    // named "move" and "redirect" by their value attribute.
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(
      screen.getByRole('radio', { name: 'Move my followers' })
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: 'Only show a redirect' })
    ).not.toBeChecked()
  })

  it('shows the actor-changed alert on a 409 Actor changed', async () => {
    mockMove.mockRejectedValueOnce(
      new client.ApiRequestError('Actor changed', 409)
    )

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('Your active profile changed')
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // The raw message is not shown as the SaveBar error.
    expect(
      screen.queryByText((_, element) =>
        element?.classList.contains('text-destructive-text')
          ? element.textContent === 'Actor changed'
          : false
      )
    ).toBeNull()
  })

  it('picks the cooldown back up from a 429', async () => {
    mockMove.mockRejectedValueOnce(
      new client.ApiRequestError('Too many moves', 429)
    )
    mockGetMigration.mockResolvedValueOnce({
      movedTo: null,
      migrations: [],
      cooldownUntil: '2026-11-23T00:00:00.000Z',
      followersCount: 12
    })

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(mockGetMigration).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna'
      })
    })
    // The cooldown picked up from the re-read keeps the action off.
    expect(
      screen.getByRole('button', { name: 'Move followers' })
    ).toBeDisabled()
  })

  it('maps an unresolvable account to the field error', async () => {
    mockMove.mockRejectedValueOnce(
      new client.ApiRequestError('Record not found', 404)
    )

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not find that account. Check the handle and try again.'
        )
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('New account')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    // The dialog is gone, so the field error is what is on the page.
    expect(
      screen.queryByRole('dialog', { name: 'Move your followers' })
    ).not.toBeInTheDocument()
  })

  it('maps a malformed account to the same field error', async () => {
    mockMove.mockRejectedValueOnce(
      new client.ApiRequestError('Invalid account', 422)
    )

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not find that account. Check the handle and try again.'
        )
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('New account')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })

  it('leaves a focus request for the notice after a move', async () => {
    mockMove.mockResolvedValueOnce({
      movedTo: { id: 'https://new.example/users/may', acct: 'may@new.example' },
      migrations: [],
      cooldownUntil: null,
      followersCount: 12
    })

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    fillMove()
    fireEvent.click(screen.getByRole('button', { name: 'Move followers' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Move your followers'
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Move followers' })
    )

    await waitFor(() => {
      // The refresh swaps this form for the MovedNotice, which takes the
      // request on mount and focuses its own Alert.
      expect(takeMovingFocus('moved-notice')).toBe(true)
    })
  })

  it('takes the focus request left by a cancelled redirect', () => {
    requestMovingFocus('move-form')

    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    expect(document.activeElement).toBe(
      screen
        .getByText('Followers move. Posts stay here.')
        .closest('[tabindex="-1"]')
    )
  })

  it('leaves focus alone on a plain page load', () => {
    render(
      <MoveForm
        actorId="https://llun.test/users/anna"
        hasPassword
        currentHandle="anna@llun.test"
        cooldownUntil={null}
      />
    )

    expect(document.activeElement).toBe(document.body)
  })
})

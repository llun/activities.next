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

import type { AccountHandleState } from '@/lib/client'
import * as client from '@/lib/client'

import { HandleRenameForm } from './HandleRenameForm'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh })
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
    getAccountHandle: vi.fn(),
    renameAccountHandle: vi.fn()
  }
})

const mockGetAccountHandle = vi.mocked(client.getAccountHandle)
const mockRename = vi.mocked(client.renameAccountHandle)

const handleState = (
  overrides: Partial<AccountHandleState> = {}
): AccountHandleState => ({
  actorId: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  acct: 'anna@llun.test',
  history: [
    {
      id: 'h1',
      actorId: 'https://llun.test/users/anna',
      username: 'anna',
      domain: 'llun.test',
      createdAt: 1700000000000,
      replacedAt: null
    }
  ],
  cooldownUntil: null,
  domains: ['llun.test'],
  ...overrides
})

const submit = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Change handle' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Change your handle'
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change handle' }))
}

describe('HandleRenameForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the current handle and no domain picker with a single domain', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    // The handle also heads the live preview, so it is on the page twice.
    expect(screen.getAllByText('@anna@llun.test').length).toBeGreaterThan(0)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers a domain Select only when there is more than one domain', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({ domains: ['llun.test', 'run.llun.dev'] })}
      />
    )

    const select = screen.getByRole('combobox', { name: 'Domain' })
    expect(select).toHaveValue('llun.test')
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['llun.test', 'run.llun.dev'])
  })

  it('previews the new handle live', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({ domains: ['llun.test', 'run.llun.dev'] })}
      />
    )

    expect(screen.getAllByText('@anna@llun.test').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Domain' }), {
      target: { value: 'run.llun.dev' }
    })

    expect(screen.getByText('@may@run.llun.dev')).toBeInTheDocument()
  })

  it('sends a domain change on its own, keeping the current username', async () => {
    mockRename.mockResolvedValueOnce(
      handleState({ domain: 'run.llun.dev', acct: 'anna@run.llun.dev' })
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({ domains: ['llun.test', 'run.llun.dev'] })}
      />
    )

    // Only the domain changes: the preview promises @anna@run.llun.dev, so
    // the action has to be available without retyping the username.
    fireEvent.change(screen.getByRole('combobox', { name: 'Domain' }), {
      target: { value: 'run.llun.dev' }
    })
    expect(screen.getByText('@anna@run.llun.dev')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change handle' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })
    expect(
      screen.getByRole('button', { name: 'Change handle' })
    ).not.toBeDisabled()

    await submit()

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        username: 'anna',
        domain: 'run.llun.dev',
        password: 'secret'
      })
    })
  })

  it('refreshes the page after a rename', async () => {
    // A rename always starts the cooldown, so the server answers with
    // cooldownUntil set.
    mockRename.mockResolvedValueOnce(
      handleState({
        username: 'may',
        acct: 'may@llun.test',
        cooldownUntil: '2026-11-27T00:00:00.000Z'
      })
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('focuses the cooldown and announces the new handle after a rename', async () => {
    mockRename.mockResolvedValueOnce(
      handleState({
        username: 'may',
        acct: 'may@llun.test',
        cooldownUntil: '2026-11-27T00:00:00.000Z'
      })
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      expect(
        screen.getByText(/You can change your handle again on/)
      ).toBeInTheDocument()
    })
    // The closed dialog would return focus to the SaveBar button that
    // unmounted with the form; the cooldown Frame takes it instead.
    expect(document.activeElement).toBe(
      screen
        .getByRole('button', { name: 'Change handle' })
        .closest('[tabindex="-1"]')
    )
    const announcement = screen.getByText('Your handle is now @may@llun.test.')
    expect(announcement).toHaveAttribute('role', 'status')
    expect(
      screen.queryByRole('dialog', { name: 'Change your handle' })
    ).not.toBeInTheDocument()
  })

  it('shows the actor-changed alert on a 409 Actor changed', async () => {
    mockRename.mockRejectedValueOnce(
      new client.ApiRequestError('Actor changed', 409)
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

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

  it('asks for the password on an account that has one', async () => {
    mockRename.mockResolvedValueOnce(handleState({ username: 'may' }))

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Current username')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    // The action stays off until the password confirms it is the owner.
    expect(screen.getByRole('button', { name: 'Change handle' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        username: 'may',
        password: 'secret'
      })
    })
  })

  it('asks for the current username on a passwordless account', async () => {
    mockRename.mockResolvedValueOnce(handleState({ username: 'may' }))

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword={false}
        initialHandle={handleState()}
      />
    )

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current username')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Current username'), {
      target: { value: 'anna' }
    })

    await submit()

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        username: 'may',
        currentUsername: 'anna'
      })
    })
  })

  it('confirms before the rename is sent, and Cancel sends nothing', async () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change handle' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Change your handle'
    })
    expect(
      within(dialog).getByText(/Your new handle will be/)
    ).toBeInTheDocument()
    expect(within(dialog).getByText('@may@llun.test')).toBeInTheDocument()
    expect(mockRename).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(mockRename).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('dialog', { name: 'Change your handle' })
    ).not.toBeInTheDocument()
  })

  it('maps "Username already exists" to the field error', async () => {
    mockRename.mockRejectedValueOnce(
      new client.ApiRequestError('Username already exists', 422)
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'taken' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      expect(screen.getByText('That username is taken')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('New handle')).toHaveAccessibleDescription(
      /That username is taken/
    )
  })

  it('replaces the form with the date while the cooldown runs', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({
          cooldownUntil: '2026-11-23T00:00:00.000Z'
        })}
      />
    )

    expect(
      screen.getByText(/You can change your handle again on/)
    ).toBeInTheDocument()
    expect(screen.getByText('23 Nov 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change handle' })).toBeDisabled()
    expect(screen.queryByLabelText('New handle')).not.toBeInTheDocument()
    // The announcement belongs to a rename that just succeeded, not to a
    // cooldown the account already had at load.
    expect(
      screen.queryByText('Your handle is now @anna@llun.test.')
    ).not.toBeInTheDocument()
  })

  it('picks the cooldown back up from a 429 and shows the date', async () => {
    mockRename.mockRejectedValueOnce(
      new client.ApiRequestError('Too many handle changes', 429)
    )
    mockGetAccountHandle.mockResolvedValueOnce(
      handleState({ cooldownUntil: '2026-11-23T00:00:00.000Z' })
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      expect(mockGetAccountHandle).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna'
      })
      expect(
        screen.getByText(/You can change your handle again on/)
      ).toBeInTheDocument()
    })
  })

  it('closes the dialog and focuses the cooldown after a 429', async () => {
    mockRename.mockRejectedValueOnce(
      new client.ApiRequestError('Too many handle changes', 429)
    )
    mockGetAccountHandle.mockResolvedValueOnce(
      handleState({ cooldownUntil: '2026-11-23T00:00:00.000Z' })
    )

    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState()}
      />
    )

    fireEvent.change(screen.getByLabelText('New handle'), {
      target: { value: 'may' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' }
    })

    await submit()

    await waitFor(() => {
      // The cooldown Frame replaced the form, and it holds focus: without
      // it the closed dialog would leave focus on the page body.
      expect(document.activeElement).toBe(
        screen
          .getByRole('button', { name: 'Change handle' })
          .closest('[tabindex="-1"]')
      )
    })
    expect(
      screen.queryByRole('dialog', { name: 'Change your handle' })
    ).not.toBeInTheDocument()
  })

  it('leaves focus alone when the cooldown is already running at load', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({
          cooldownUntil: '2026-11-23T00:00:00.000Z'
        })}
      />
    )

    expect(
      screen.getByText(/You can change your handle again on/)
    ).toBeInTheDocument()
    expect(document.activeElement).toBe(document.body)
  })

  it('shows the last change date once there is history', () => {
    render(
      <HandleRenameForm
        actorId="https://llun.test/users/anna"
        hasPassword
        initialHandle={handleState({
          history: [
            {
              id: 'h2',
              actorId: 'https://llun.test/users/anna',
              username: 'anna',
              domain: 'llun.test',
              createdAt: 1700000000000,
              replacedAt: null
            },
            {
              id: 'h1',
              actorId: 'https://llun.test/users/anna',
              username: 'old',
              domain: 'llun.test',
              createdAt: 1600000000000,
              replacedAt: 1700000000000
            }
          ]
        })}
      />
    )

    expect(screen.getByText(/Last changed:/)).toBeInTheDocument()
    expect(screen.getByText('14 Nov 2023')).toBeInTheDocument()
  })
})

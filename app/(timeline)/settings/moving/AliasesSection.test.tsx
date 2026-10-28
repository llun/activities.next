/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AccountAliasItem } from '@/lib/client'
import * as client from '@/lib/client'

import { AliasesSection, normalizeAliasInput } from './AliasesSection'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
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
    addAccountAlias: vi.fn(),
    removeAccountAlias: vi.fn()
  }
})

const mockAdd = vi.mocked(client.addAccountAlias)
const mockRemove = vi.mocked(client.removeAccountAlias)

const alias = (id: string, acct: string): AccountAliasItem => ({ id, acct })

describe('AliasesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.state = 'online'
  })

  it('lists the old accounts with a Remove that needs no confirm', async () => {
    mockRemove.mockResolvedValueOnce([])
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    expect(screen.getByText('@anna@old.example')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('remove-alias'))

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        id: 'https://old.example/users/anna'
      })
    })
    // No dialog ever opened: the row is removed on the first click.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names each Remove button after its alias', () => {
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example'),
          alias('https://older.example/users/anna', 'anna@older.example'),
          alias('https://gone.example/users/anna', null as unknown as string)
        ]}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Remove @anna@old.example' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove @anna@older.example' })
    ).toBeInTheDocument()
    // A row whose handle is unknown falls back to the id.
    expect(
      screen.getByRole('button', {
        name: 'Remove https://gone.example/users/anna'
      })
    ).toBeInTheDocument()
  })

  it('shows the actor-changed alert when adding hits 409 Actor changed', async () => {
    mockAdd.mockRejectedValueOnce(
      new client.ApiRequestError('Actor changed', 409)
    )
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    fireEvent.change(screen.getByLabelText('Old account'), {
      target: { value: '@you@old.example' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(
        screen.getByText('Your active profile changed')
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // The raw message does not land in the field error.
    expect(
      screen.getByLabelText('Old account')
    ).not.toHaveAccessibleDescription(/Actor changed/)
  })

  it('shows the actor-changed alert when removing hits 409 Actor changed', async () => {
    mockRemove.mockRejectedValueOnce(
      new client.ApiRequestError('Actor changed', 409)
    )
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('remove-alias'))

    await waitFor(() => {
      expect(
        screen.getByText('Your active profile changed')
      ).toBeInTheDocument()
    })
    // The raw message is not shown as the standalone error Alert.
    expect(
      screen.queryByText((_, element) =>
        element?.getAttribute('data-slot') === 'alert'
          ? element.textContent === 'Actor changed'
          : false
      )
    ).toBeNull()
  })

  it('says so when the list is empty', () => {
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    expect(screen.getByText('No old accounts yet')).toBeInTheDocument()
    expect(
      screen.getByText('Add the handle you are moving from.')
    ).toBeInTheDocument()
  })

  it('normalises the handle before adding it', async () => {
    mockAdd.mockResolvedValueOnce([
      alias('https://old.example/users/anna', 'anna@old.example')
    ])
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    const input = screen.getByLabelText('Old account')
    expect(input).toHaveAttribute('name', 'alias')
    expect(screen.getByTestId('aliases-form')).toContainElement(input)

    fireEvent.change(input, { target: { value: ' @anna@old.example ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/anna',
        acct: 'anna@old.example'
      })
    })
  })

  it('maps a not-found account to the field error', async () => {
    mockAdd.mockRejectedValueOnce(
      new client.ApiRequestError('Account not found', 404)
    )
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    fireEvent.change(screen.getByLabelText('Old account'), {
      target: { value: '@nobody@old.example' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not find that account. Check the handle and try again.'
        )
      ).toBeInTheDocument()
    })
  })

  it('carries the hint from the plan', () => {
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    expect(
      screen.getByText(
        'Do this first, then start the move on the old server (in Mastodon: Preferences, Account, Moving from a different account).'
      )
    ).toBeInTheDocument()
  })

  it('caps the list at ten old accounts', () => {
    const ten: AccountAliasItem[] = Array.from({ length: 10 }, (_, i) =>
      alias(`https://old${i}.example/users/anna`, `anna@old${i}.example`)
    )
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={ten}
      />
    )

    expect(
      screen.getByText('You can add up to 10 old accounts.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('normalises one leading @ and nothing else', () => {
    expect(normalizeAliasInput(' @you@old.server ')).toBe('you@old.server')
    expect(normalizeAliasInput('you@old.server')).toBe('you@old.server')
    expect(normalizeAliasInput('@@you@old.server')).toBe('@you@old.server')
  })

  it('disables Add and Remove while offline, with a note', () => {
    connection.state = 'offline'
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(screen.getByTestId('remove-alias')).toBeDisabled()
    expect(screen.getByText("You're offline")).toBeInTheDocument()
  })

  it('keeps Add and Remove available while the server is unreachable', () => {
    // `unreachable` is the health probe failing while the device is online:
    // only the browser's own `offline` state disables the actions, so each
    // keeps its own error path.
    connection.state = 'unreachable'
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled()
    expect(screen.getByTestId('remove-alias')).not.toBeDisabled()
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument()
  })

  it('moves focus to the input when the account is not found', async () => {
    mockAdd.mockRejectedValueOnce(
      new client.ApiRequestError('Account not found', 404)
    )
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    const input = screen.getByLabelText('Old account')
    fireEvent.change(input, { target: { value: '@nobody@old.example' } })
    const add = screen.getByRole('button', { name: 'Add' })
    add.focus()
    fireEvent.click(add)

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not find that account. Check the handle and try again.'
        )
      ).toBeInTheDocument()
    })
    // The field error is on the input, so focus moves there to have it read,
    // not back to the Add button that was pressed.
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('maps an add network failure to the plain message, not the browser text', async () => {
    mockAdd.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[]}
      />
    )

    fireEvent.change(screen.getByLabelText('Old account'), {
      target: { value: '@you@old.example' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(screen.getByText('Could not add that account')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('moves focus to the input after a successful remove', async () => {
    // The pressed Remove button unmounts with its row, so focus would
    // otherwise fall to the page body.
    mockRemove.mockResolvedValueOnce([])
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    const input = screen.getByLabelText('Old account')
    const remove = screen.getByTestId('remove-alias')
    remove.focus()
    fireEvent.click(remove)

    await waitFor(() => {
      expect(screen.queryByTestId('remove-alias')).toBeNull()
    })
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('maps a remove network failure to the plain message, not the browser text', async () => {
    mockRemove.mockRejectedValueOnce(new TypeError('Load failed'))
    render(
      <AliasesSection
        actorId="https://llun.test/users/anna"
        initialAliases={[
          alias('https://old.example/users/anna', 'anna@old.example')
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('remove-alias'))

    await waitFor(() => {
      expect(
        screen.getByText('Could not remove that account')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Load failed')).not.toBeInTheDocument()
  })
})

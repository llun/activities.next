/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AccountAliasItem } from '@/lib/client'
import * as client from '@/lib/client'

import { AliasesSection, normalizeAliasInput } from './AliasesSection'

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
})

/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import Page from './page'

const getRelays = vi.fn()
const mockDatabase = { getRelays }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('@/app/(timeline)/admin/relays/actions', () => ({
  addRelayAction: vi.fn(),
  removeRelayAction: vi.fn(),
  subscribeRelayAction: vi.fn(),
  unsubscribeRelayAction: vi.fn()
}))

const relay = (overrides: Record<string, unknown>) => ({
  id: 'relay-1',
  inboxUrl: 'https://relay.example/inbox',
  state: 'idle',
  actorId: null,
  lastError: null,
  ...overrides
})

const renderPage = async (status?: string) =>
  render(await Page({ searchParams: Promise.resolve({ status }) }))

describe('/admin/relays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRelays.mockResolvedValue([])
  })

  it('has a labelled form to add a relay', async () => {
    await renderPage()

    const input = screen.getByLabelText('Inbox URL')
    expect(input).toHaveAttribute('name', 'inboxUrl')
    expect(input).toBeRequired()
    expect(screen.getByRole('button', { name: 'Add relay' })).toHaveAttribute(
      'type',
      'submit'
    )
  })

  it('says so, and points at the form, when there are no relays', async () => {
    await renderPage()

    expect(screen.getByText('No relays configured')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Relays' })).toBeNull()
  })

  it('lists each relay with its state and the action that fits it', async () => {
    getRelays.mockResolvedValue([
      relay({ id: 'r1', state: 'idle' }),
      relay({
        id: 'r2',
        inboxUrl: 'https://two.example/inbox',
        state: 'accepted',
        actorId: 'https://two.example/actor'
      }),
      relay({
        id: 'r3',
        inboxUrl: 'https://three.example/inbox',
        state: 'rejected',
        lastError: 'Relay refused the request'
      }),
      relay({
        id: 'r4',
        inboxUrl: 'https://four.example/inbox',
        state: 'pending'
      })
    ])

    await renderPage()

    const rows = within(
      screen.getByRole('list', { name: 'Relays' })
    ).getAllByRole('listitem')
    expect(rows).toHaveLength(4)

    // Idle and rejected relays can subscribe; the others can unsubscribe.
    expect(within(rows[0]).getByText('idle')).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole('button', { name: 'Subscribe' })
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText('accepted')).toBeInTheDocument()
    expect(
      within(rows[1]).getByText('https://two.example/actor')
    ).toBeInTheDocument()
    expect(
      within(rows[1]).getByRole('button', { name: 'Unsubscribe' })
    ).toBeInTheDocument()
    expect(within(rows[2]).getByText('rejected')).toBeInTheDocument()
    expect(
      within(rows[2]).getByText('Relay refused the request')
    ).toBeInTheDocument()
    expect(
      within(rows[2]).getByRole('button', { name: 'Subscribe' })
    ).toBeInTheDocument()
    expect(
      within(rows[3]).getByRole('button', { name: 'Unsubscribe' })
    ).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole('button', {
        name: 'Remove relay https://relay.example/inbox'
      })
    ).toBeInTheDocument()
  })

  it('posts the relay id with every row action', async () => {
    getRelays.mockResolvedValue([relay({ id: 'relay-9' })])

    await renderPage()

    const row = screen.getAllByRole('listitem')[0]
    const ids = Array.from(
      row.querySelectorAll<HTMLInputElement>('input[name="id"]')
    ).map((input) => input.value)
    expect(ids).toEqual(['relay-9', 'relay-9'])
  })

  it.each([
    ['relay-added', 'success', 'Relay added and subscription requested'],
    ['relay-removed', 'success', 'Relay removed'],
    ['invalid-inbox-url', 'error', 'Enter a valid relay inbox URL'],
    [
      'duplicate-inbox-url',
      'error',
      'A relay with that inbox URL already exists'
    ]
  ])('reports %s as a %s alert', async (status, tone, message) => {
    await renderPage(status)

    const alert = screen.getByText(message).closest('[data-slot="alert"]')
    expect(alert).toHaveAttribute('data-tone', tone)
  })

  it('shows no alert without a status', async () => {
    await renderPage()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

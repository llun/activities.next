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

import {
  AccountAppRow,
  AccountSessionRow,
  AccountSessions,
  SessionActor
} from '@/app/(timeline)/account/sessions/AccountSessions'

const deleteSession = vi.fn()
const revokeOtherSessions = vi.fn()
const revokeConnectedApp = vi.fn()

vi.mock('@/lib/client', () => ({
  deleteSession: (args: unknown) => deleteSession(args),
  revokeOtherSessions: () => revokeOtherSessions(),
  revokeConnectedApp: (args: unknown) => revokeConnectedApp(args)
}))

vi.mock('@/app/(timeline)/account/LogoutButton', () => ({
  LogoutButton: () => <button type="button">Logout</button>
}))

const NOW = new Date('2026-06-28T12:00:00.000Z').getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const anna: SessionActor = {
  id: 'anna',
  name: 'Anna Lin',
  handle: '@anna@llun.social',
  iconUrl: null
}
const ben: SessionActor = {
  id: 'ben',
  name: 'Ben Carter',
  handle: '@ben@llun.social',
  iconUrl: null
}

const sessions: AccountSessionRow[] = [
  // Ben's session comes first in the input, but Anna holds the current session,
  // so Anna's group must float to the top.
  {
    token: 'ben-1',
    actor: ben,
    createdAt: NOW - DAY,
    expireAt: NOW + 3 * DAY,
    current: false
  },
  {
    token: 'anna-current',
    actor: anna,
    createdAt: NOW - HOUR,
    expireAt: NOW + 7 * DAY,
    current: true
  },
  {
    token: 'anna-soon',
    actor: anna,
    createdAt: NOW - 2 * HOUR,
    expireAt: NOW + HOUR,
    current: false
  }
]

const apps: AccountAppRow[] = [
  {
    clientId: 'ice-cubes',
    actorId: 'anna',
    actor: anna,
    name: 'Ice Cubes',
    website: 'icecubesapp.com',
    scopes: ['read', 'write'],
    authorizedLabel: 'Jun 2, 2026',
    signIn: false
  },
  {
    clientId: 'la-suite-docs',
    actorId: 'ben',
    actor: ben,
    name: 'La Suite Docs',
    website: 'docs.llun.dev',
    scopes: ['openid', 'read:accounts'],
    authorizedLabel: 'Jun 10, 2026',
    signIn: true
  }
]

const renderSessions = (
  props?: Partial<Parameters<typeof AccountSessions>[0]>
) =>
  render(
    <AccountSessions
      currentTime={NOW}
      sessions={sessions}
      apps={apps}
      {...props}
    />
  )

describe('AccountSessions', () => {
  beforeEach(() => {
    deleteSession.mockResolvedValue(true)
    revokeOtherSessions.mockResolvedValue(true)
    revokeConnectedApp.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('summarizes sessions, apps, and actors', () => {
    renderSessions()
    expect(
      screen.getByText(
        '3 active sessions and 2 connected apps across 2 actors.'
      )
    ).toBeInTheDocument()
  })

  it('floats the actor holding the current session to the top', () => {
    renderSessions()
    const headers = screen
      .getAllByText(/Lin|Carter/)
      .map((node) => node.textContent)
    expect(headers[0]).toBe('Anna Lin')
  })

  it('pins the current device and omits its revoke control', () => {
    renderSessions()
    // The "This device" badge (a span) is distinct from the sign-out section
    // heading of the same name.
    expect(
      screen.getByText('This device', { selector: 'span' })
    ).toBeInTheDocument()
    // current session + 2 other sessions + 2 apps → 4 revoke buttons, never 5.
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(4)
  })

  it('flags a session expiring within a day', () => {
    renderSessions()
    expect(screen.getByText('Expiring soon')).toBeInTheDocument()
  })

  it('never flags an already-expired session as expiring soon', () => {
    renderSessions({
      sessions: [
        {
          token: 'cur',
          actor: anna,
          createdAt: NOW - HOUR,
          expireAt: NOW + 7 * DAY,
          current: true
        },
        {
          token: 'expired',
          actor: anna,
          createdAt: NOW - 3 * DAY,
          expireAt: NOW - DAY,
          current: false
        }
      ],
      apps: []
    })
    expect(screen.queryByText('Expiring soon')).not.toBeInTheDocument()
  })

  it('classifies connected apps and SSO sign-ins with their scopes', () => {
    renderSessions()
    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.getByText('Sign-in')).toBeInTheDocument()
    expect(screen.getByText('read:accounts')).toBeInTheDocument()
    expect(
      screen.getByText(/docs\.llun\.dev · Signs you in Jun 10, 2026/)
    ).toBeInTheDocument()
  })

  it('revokes all other sessions and keeps the current one', async () => {
    renderSessions()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all others' }))

    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByText('No other active sessions')).toBeInTheDocument()
    )
    // Only the current session row remains (the other two are gone), so there is
    // exactly one "Web session" left.
    expect(screen.getAllByText('Web session')).toHaveLength(1)
  })

  it('revokes a connected app scoped to its actor', async () => {
    renderSessions()
    const row = screen.getByText('Ice Cubes').closest('.flex.items-start')
    expect(row).not.toBeNull()
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Revoke' })
    )

    await waitFor(() =>
      expect(revokeConnectedApp).toHaveBeenCalledWith({
        clientId: 'ice-cubes',
        actorId: 'anna'
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('Ice Cubes')).not.toBeInTheDocument()
    )
  })
})

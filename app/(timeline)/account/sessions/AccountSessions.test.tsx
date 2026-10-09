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
import { createDeferred } from '@/lib/testing/deferred'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'

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
    id: 'ben-1',
    actor: ben,
    createdAt: NOW - DAY,
    expireAt: NOW + 3 * DAY,
    current: false
  },
  {
    id: 'anna-current',
    actor: anna,
    createdAt: NOW - HOUR,
    expireAt: NOW + 7 * DAY,
    current: true
  },
  {
    id: 'anna-soon',
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
    authorizedAt: NOW - 26 * DAY,
    signIn: false
  },
  {
    clientId: 'la-suite-docs',
    actorId: 'ben',
    actor: ben,
    name: 'La Suite Docs',
    website: 'docs.llun.dev',
    scopes: ['openid', 'read:accounts'],
    authorizedAt: NOW - 18 * DAY,
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
          id: 'cur',
          actor: anna,
          createdAt: NOW - HOUR,
          expireAt: NOW + 7 * DAY,
          current: true
        },
        {
          id: 'expired',
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
      screen.getByText('docs.llun.dev · Signs you in 18 days ago')
    ).toBeInTheDocument()
    expect(
      screen.getByText('icecubesapp.com · Authorized 26 days ago')
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

  // A current session plus one other session — a minimal set for the
  // failure/in-flight cases that needs an unambiguous "Revoke" target.
  const oneOther: AccountSessionRow[] = [
    {
      id: 'cur',
      actor: anna,
      createdAt: NOW - HOUR,
      expireAt: NOW + 7 * DAY,
      current: true
    },
    {
      id: 'other',
      actor: anna,
      createdAt: NOW - 2 * HOUR,
      expireAt: NOW + 3 * DAY,
      current: false
    }
  ]

  it('revokes a single session by its id', async () => {
    renderSessions({ sessions: oneOther, apps: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(deleteSession).toHaveBeenCalledWith({ id: 'other' })
    )
    expect(deleteSession).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('Web session')).toHaveLength(1)
    expect(
      screen.queryByText('Failed to revoke that session. Please try again.')
    ).not.toBeInTheDocument()
  })

  it('restores the session and shows an error when a revoke fails', async () => {
    deleteSession.mockResolvedValueOnce(false)
    renderSessions({ sessions: oneOther, apps: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(
        screen.getByText('Failed to revoke that session. Please try again.')
      ).toBeInTheDocument()
    )
    // The optimistic removal is rolled back: both sessions are present again.
    expect(screen.getAllByText('Web session')).toHaveLength(2)
  })

  it('rolls back and shows an error when the revoke request rejects', async () => {
    // A network error rejects rather than resolving false; it must still roll
    // back the optimistic removal and surface the error (not go unhandled).
    deleteSession.mockRejectedValueOnce(new Error('network down'))
    renderSessions({ sessions: oneOther, apps: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(
        screen.getByText('Failed to revoke that session. Please try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getAllByText('Web session')).toHaveLength(2)
  })

  it('restores all sessions and shows an error when revoke-all fails', async () => {
    revokeOtherSessions.mockResolvedValueOnce(false)
    renderSessions({ sessions: oneOther, apps: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke all others' }))

    await waitFor(() =>
      expect(
        screen.getByText(
          'Failed to revoke the other sessions. Please try again.'
        )
      ).toBeInTheDocument()
    )
    expect(screen.getAllByText('Web session')).toHaveLength(2)
  })

  it('restores the app and shows an error when an app revoke fails', async () => {
    revokeConnectedApp.mockResolvedValueOnce(false)
    renderSessions({ sessions: [oneOther[0]], apps: [apps[0]] })

    const row = screen.getByText('Ice Cubes').closest('.flex.items-start')
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Revoke' })
    )

    await waitFor(() =>
      expect(
        screen.getByText('Failed to revoke that app. Please try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getByText('Ice Cubes')).toBeInTheDocument()
  })

  it('disables every revoke control while a request is in flight', async () => {
    const deferred = createDeferred<boolean>()
    revokeOtherSessions.mockImplementationOnce(() => deferred.promise)
    // A current session + one other (drives "Revoke all others") and an app
    // whose Revoke button stays mounted while the revoke-all is in flight.
    renderSessions({ sessions: oneOther, apps: [apps[0]] })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke all others' }))

    const appRevoke = () =>
      within(
        screen
          .getByText('Ice Cubes')
          .closest('.flex.items-start') as HTMLElement
      ).getByRole('button', { name: 'Revoke' })

    // While the request is pending, every other revoke control is disabled, so
    // a click on one is a DOM no-op (the client fn is never reached). The
    // synchronous pendingRef lock additionally guards the same-tick,
    // pre-state-flush double-click that this DOM gate can't — that window isn't
    // reproducible under React Testing Library, which flushes on each fireEvent.
    await waitFor(() => expect(appRevoke()).toBeDisabled())
    fireEvent.click(appRevoke())
    expect(revokeConnectedApp).not.toHaveBeenCalled()

    deferred.resolve(true)
    await waitFor(() => expect(appRevoke()).not.toBeDisabled())
  })

  it('groups null-actor rows under "Other sessions" and revokes apps with a null actorId', async () => {
    renderSessions({
      sessions: [
        {
          id: 'orphan',
          actor: null,
          createdAt: NOW - HOUR,
          expireAt: NOW + 3 * DAY,
          current: false
        }
      ],
      apps: [
        {
          clientId: 'client-credentials',
          actorId: null,
          actor: null,
          name: 'Client Credentials',
          website: null,
          scopes: ['read'],
          authorizedAt: NOW - 27 * DAY,
          signIn: false
        }
      ]
    })

    expect(screen.getByText('Other sessions')).toBeInTheDocument()

    const row = screen
      .getByText('Client Credentials')
      .closest('.flex.items-start')
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Revoke' })
    )

    await waitFor(() =>
      expect(revokeConnectedApp).toHaveBeenCalledWith({
        clientId: 'client-credentials',
        actorId: null
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('Client Credentials')).not.toBeInTheDocument()
    )
  })

  it("hydrates the server's UTC sign-in time without a mismatch, then shows the reader's own", async () => {
    // 02:30 UTC on 28 Jun is 22:30 on 27 Jun in New York (EDT, UTC-4), so the
    // zone moves both the clock and the day formatRelative names.
    const element = (
      <AccountSessions
        currentTime={NOW}
        sessions={[
          {
            id: 'anna-current',
            actor: anna,
            createdAt: Date.parse('2026-06-28T02:30:00.000Z'),
            expireAt: NOW + 7 * DAY,
            current: true
          }
        ]}
        apps={[]}
      />
    )

    await withTimeZone('America/New_York', async () => {
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(element)

      try {
        expect(serverHtml).toContain('today at 2:30 AM')
        expect(onRecoverableError).not.toHaveBeenCalled()
        expect(container).toHaveTextContent('Signed in yesterday at 10:30 PM')
      } finally {
        unmount()
      }
    })
  })
})

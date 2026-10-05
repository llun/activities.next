import type { ReactElement } from 'react'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => path)
}))

const CURRENT_TOKEN = 'current-session-token-secret'
const OTHER_TOKEN = 'other-session-token-secret'

describe('/account/sessions', () => {
  beforeEach(() => {
    const now = Date.now()
    vi.mocked(getServerAuthSession).mockResolvedValue({
      session: { token: CURRENT_TOKEN }
    } as unknown as Awaited<ReturnType<typeof getServerAuthSession>>)
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'https://activities.local/users/llun',
      account: { id: 'account-id' }
    } as unknown as Awaited<ReturnType<typeof getActorFromSession>>)
    vi.mocked(getDatabase).mockReturnValue({
      getAccountAllSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-current',
          token: CURRENT_TOKEN,
          accountId: 'account-id',
          actorId: null,
          expireAt: now + 60_000,
          createdAt: now - 1_000,
          updatedAt: now - 1_000
        },
        {
          id: 'session-other',
          token: OTHER_TOKEN,
          accountId: 'account-id',
          actorId: null,
          expireAt: now + 60_000,
          createdAt: now - 2_000,
          updatedAt: now - 2_000
        }
      ]),
      getActorsForAccount: vi.fn().mockResolvedValue([]),
      getAccountConnectedApps: vi.fn().mockResolvedValue([])
    } as unknown as ReturnType<typeof getDatabase>)
  })

  // AccountSessions is a Client Component, so its props are serialized into
  // the RSC payload. A session token is the credential behind the session
  // cookie: sending it would hand every session's credential to any script on
  // the page. The current-device marker is decided server-side instead.
  it('sends session ids and a server-computed current flag, never tokens', async () => {
    const element = (await Page()) as ReactElement
    const props = element.props as {
      sessions: Array<{ id: string; current: boolean }>
    }

    const serialized = JSON.stringify(props)
    expect(serialized).not.toContain(CURRENT_TOKEN)
    expect(serialized).not.toContain(OTHER_TOKEN)
    expect(props.sessions.map(({ id, current }) => ({ id, current }))).toEqual([
      { id: 'session-current', current: true },
      { id: 'session-other', current: false }
    ])
  })
})

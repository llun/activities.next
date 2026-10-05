import type { ReactElement } from 'react'

import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => path)
}))

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----actor-signing-key'
const PASSWORD_HASH = '$2b$10$password-hash-value'
const VERIFICATION_CODE = 'verification-code-value'
const RESET_CODE = 'reset-code-value'

const account = {
  id: 'account-id',
  email: 'rider@example.com',
  passwordHash: PASSWORD_HASH,
  verificationCode: VERIFICATION_CODE,
  passwordResetCode: RESET_CODE
}

const storedActor = (username: string) => ({
  id: `https://activities.local/users/${username}`,
  username,
  domain: 'activities.local',
  name: username.toUpperCase(),
  publicKey: 'public-key',
  privateKey: PRIVATE_KEY,
  account
})

describe('/settings/notifications', () => {
  beforeEach(() => {
    vi.mocked(getActorFromSession).mockResolvedValue(
      storedActor('llun') as unknown as Awaited<
        ReturnType<typeof getActorFromSession>
      >
    )
    vi.mocked(getDatabase).mockReturnValue({
      getActorsForAccount: vi
        .fn()
        .mockResolvedValue([storedActor('llun'), storedActor('second')]),
      getActorSettings: vi.fn().mockResolvedValue(null)
    } as unknown as ReturnType<typeof getDatabase>)
  })

  // NotificationSettings is a Client Component: its props are serialized into
  // the RSC payload the browser downloads, so the stored actors' signing keys
  // and account secrets must never be among them.
  it('passes only actor display fields to the client settings component', async () => {
    const element = (await Page({
      searchParams: Promise.resolve({})
    })) as ReactElement
    const props = element.props as { actors: unknown }

    const serialized = JSON.stringify(props)
    for (const secret of [
      PRIVATE_KEY,
      PASSWORD_HASH,
      VERIFICATION_CODE,
      RESET_CODE
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(props.actors).toEqual([
      {
        id: 'https://activities.local/users/llun',
        username: 'llun',
        domain: 'activities.local',
        name: 'LLUN'
      },
      {
        id: 'https://activities.local/users/second',
        username: 'second',
        domain: 'activities.local',
        name: 'SECOND'
      }
    ])
  })
})

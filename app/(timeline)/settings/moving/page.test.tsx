/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const getActorFromId = vi.fn()

const mockDatabase = { getActorFromId }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'llun.test' }))
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  }
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

const getHandleState = vi.fn()
vi.mock('@/lib/services/accounts/handleRename', () => ({
  getHandleState: (...args: unknown[]) => getHandleState(...args)
}))

const getMigrationState = vi.fn()
vi.mock('@/lib/services/accounts/migration/outgoingMove', () => ({
  getMigrationState: (...args: unknown[]) => getMigrationState(...args)
}))

const handleRenameFormProps = vi.fn()
vi.mock('./HandleRenameForm', () => ({
  HandleRenameForm: (props: Record<string, unknown>) => {
    handleRenameFormProps(props)
    return <div data-testid="handle-rename-form" />
  }
}))

const aliasesSectionProps = vi.fn()
vi.mock('./AliasesSection', () => ({
  AliasesSection: (props: Record<string, unknown>) => {
    aliasesSectionProps(props)
    return <div data-testid="aliases-section" />
  }
}))

const moveFormProps = vi.fn()
vi.mock('./MoveForm', () => ({
  MoveForm: (props: Record<string, unknown>) => {
    moveFormProps(props)
    return <div data-testid="move-form" />
  }
}))

const movedNoticeProps = vi.fn()
vi.mock('./MovedNotice', () => ({
  MovedNotice: (props: Record<string, unknown>) => {
    movedNoticeProps(props)
    return <div data-testid="moved-notice" />
  }
}))

const ACTOR = {
  id: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  alsoKnownAs: ['https://old.example/users/anna'],
  account: { id: 'acct-1', passwordHash: 'hash' }
}

const HANDLE = {
  actorId: 'https://llun.test/users/anna',
  username: 'anna',
  domain: 'llun.test',
  acct: 'anna@llun.test',
  history: [],
  cooldownUntil: null,
  domains: ['llun.test']
}

const noMove = {
  movedTo: null,
  migrations: [],
  cooldownUntil: null,
  followersCount: 12
}

describe('/settings/moving', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
    getHandleState.mockResolvedValue(HANDLE)
    getMigrationState.mockResolvedValue(noMove)
    getActorFromId.mockResolvedValue({
      id: 'https://old.example/users/anna',
      username: 'anna',
      domain: 'old.example'
    })
  })

  it('opens with the handle this page is about', async () => {
    render(await Page())

    expect(
      screen.getByText('These settings are for @anna@llun.test')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Moving' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Change your handle, or move to another account. Mastodon calls this account migration.'
      )
    ).toBeInTheDocument()
  })

  it('passes the handle, the password flag and the aliases down', async () => {
    render(await Page())

    expect(handleRenameFormProps).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/anna',
        hasPassword: true,
        initialHandle: HANDLE
      })
    )
    expect(aliasesSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/anna',
        initialAliases: [
          { id: 'https://old.example/users/anna', acct: 'anna@old.example' }
        ]
      })
    )
    expect(moveFormProps).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/anna',
        hasPassword: true,
        currentHandle: 'anna@llun.test',
        cooldownUntil: null
      })
    )
    expect(screen.getByTestId('move-form')).toBeInTheDocument()
    expect(screen.queryByTestId('moved-notice')).not.toBeInTheDocument()
  })

  it('says there is no password to confirm with', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      ...ACTOR,
      account: { id: 'acct-1', passwordHash: null }
    } as never)

    render(await Page())

    expect(handleRenameFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ hasPassword: false })
    )
    expect(moveFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ hasPassword: false })
    )
  })

  it('replaces the move form with the notice after a redirect, and turns renaming off', async () => {
    getMigrationState.mockResolvedValue({
      movedTo: { id: 'https://new.example/users/may', acct: 'may@new.example' },
      migrations: [
        {
          targetActorId: 'https://new.example/users/may',
          acct: 'may@new.example',
          kind: 'redirect',
          createdAt: '2026-10-24T00:00:00.000Z'
        }
      ],
      cooldownUntil: null,
      followersCount: 12
    })

    render(await Page())

    expect(moveFormProps).not.toHaveBeenCalled()
    expect(movedNoticeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'https://llun.test/users/anna',
        acct: 'may@new.example',
        kind: 'redirect',
        movedAt: '2026-10-24T00:00:00.000Z',
        cooldownUntil: null
      })
    )
    // Renaming is off while the profile shows as moved.
    expect(handleRenameFormProps).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Changing your handle and moving are off while your profile shows as moved. Cancel the redirect to use them again.'
      )
    ).toBeInTheDocument()
  })

  it('drops the rename section entirely after a full move', async () => {
    getMigrationState.mockResolvedValue({
      movedTo: { id: 'https://new.example/users/may', acct: 'may@new.example' },
      migrations: [
        {
          targetActorId: 'https://new.example/users/may',
          acct: 'may@new.example',
          kind: 'move',
          createdAt: '2026-10-24T00:00:00.000Z'
        }
      ],
      cooldownUntil: '2026-11-23T00:00:00.000Z',
      followersCount: 12
    })

    render(await Page())

    expect(handleRenameFormProps).not.toHaveBeenCalled()
    expect(movedNoticeProps).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'move' })
    )
    expect(
      screen.queryByRole('heading', { name: 'Change your handle' })
    ).not.toBeInTheDocument()
  })

  it('signs out to the sign-in page without a session', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue(null as never)

    await expect(Page()).rejects.toThrow('redirect:/auth/signin')
  })
})

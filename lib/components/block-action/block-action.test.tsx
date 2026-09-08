/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { block, unblock } from '@/lib/client'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import { BlockAction } from './block-action'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh
  })
}))

vi.mock('@/lib/client', () => ({
  block: vi.fn(),
  unblock: vi.fn()
}))

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: 'target',
  following: false,
  showing_reblogs: false,
  notifying: false,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  languages: ['en'],
  note: '',
  ...overrides
})

describe('BlockAction', () => {
  const blockMock = block as jest.Mock
  const unblockMock = unblock as jest.Mock

  beforeEach(() => {
    blockMock.mockReset()
    unblockMock.mockReset()
    refresh.mockReset()
  })

  it('clears submitting state when block request rejects', async () => {
    let rejectBlock: (error: Error) => void = () => undefined
    blockMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectBlock = reject
      })
    )

    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block account' })
    const dialogBlockButton = within(dialog).getByRole('button', {
      name: 'Block'
    })
    fireEvent.click(dialogBlockButton)

    await waitFor(() => {
      expect(dialogBlockButton).toBeDisabled()
    })

    await act(async () => {
      rejectBlock(new Error('network failed'))
    })

    await waitFor(() => {
      expect(dialogBlockButton).toBeEnabled()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to block account. Please try again.'
    )
    expect(
      screen.getByRole('dialog', { name: 'Block account' })
    ).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('clears submitting state when unblock request rejects', async () => {
    let rejectUnblock: (error: Error) => void = () => undefined
    unblockMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUnblock = reject
      })
    )

    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ blocking: true })}
      />
    )

    const unblockButton = screen.getByRole('button', { name: 'Unblock' })
    fireEvent.click(unblockButton)

    await waitFor(() => {
      expect(unblockButton).toBeDisabled()
    })

    await act(async () => {
      rejectUnblock(new Error('network failed'))
    })

    await waitFor(() => {
      expect(unblockButton).toBeEnabled()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to unblock account. Please try again.'
    )
    expect(refresh).not.toHaveBeenCalled()
  })
})

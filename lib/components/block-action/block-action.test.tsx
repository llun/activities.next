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
  muting_expires_at: null,
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

  it.each([
    ['signed out', false, relationship()],
    ['the relationship is unknown', true, null]
  ])('renders nothing when %s', (_name, isLoggedIn, initialRelationship) => {
    const { container } = render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn={isLoggedIn}
        initialRelationship={initialRelationship}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('asks for confirmation before blocking and can be cancelled', async () => {
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block account' })
    expect(blockMock).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(blockMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
  })

  it('blocks the account, closes the dialog, offers Unblock and refreshes', async () => {
    blockMock.mockResolvedValue(relationship({ blocking: true }))
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block account' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }))
    })

    expect(blockMock).toHaveBeenCalledWith({
      targetActorId: 'https://example.test/users/target'
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('button', { name: 'Unblock' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['the request returns nothing', null],
    [
      'the server does not report the account as blocked',
      relationship({ blocking: false })
    ]
  ])('keeps the dialog open with an error when %s', async (_name, result) => {
    blockMock.mockResolvedValue(result)
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block account' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to block account. Please try again.'
    )
    expect(
      screen.getByRole('dialog', { name: 'Block account' })
    ).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('forgets a block error when the dialog is cancelled and reopened', async () => {
    blockMock.mockResolvedValue(null)
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block account' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }))
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    await screen.findByRole('dialog', { name: 'Block account' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('unblocks the account, offers Block again and refreshes', async () => {
    unblockMock.mockResolvedValue(relationship({ blocking: false }))
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ blocking: true })}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unblock' }))
    })

    expect(unblockMock).toHaveBeenCalledWith({
      targetActorId: 'https://example.test/users/target'
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Unblock' })
    ).not.toBeInTheDocument()
  })

  it.each([
    ['the request returns nothing', null],
    [
      'the server still reports the account as blocked',
      relationship({ blocking: true })
    ]
  ])('shows an error and stays blocked when %s', async (_name, result) => {
    unblockMock.mockResolvedValue(result)
    render(
      <BlockAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ blocking: true })}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unblock' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to unblock account. Please try again.'
    )
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeEnabled()
    expect(refresh).not.toHaveBeenCalled()
  })
})

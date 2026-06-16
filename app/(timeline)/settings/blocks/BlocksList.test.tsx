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

import { getBlocks, unblock } from '@/lib/client'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { BlocksList } from './BlocksList'

vi.mock('@/lib/client', () => ({
  getBlocks: vi.fn(),
  unblock: vi.fn()
}))

const createAccount = (
  id: string,
  username: string,
  displayName: string
): MastodonAccount => ({
  id,
  username,
  acct: username,
  url: `https://example.test/users/${username}`,
  display_name: displayName,
  note: '',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {
    note: '',
    fields: [],
    privacy: 'public',
    sensitive: false,
    language: null
  },
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  noindex: false,
  created_at: '2026-01-01T00:00:00.000Z',
  last_status_at: null,
  statuses_count: 0,
  followers_count: 0,
  following_count: 0
})

describe('BlocksList', () => {
  const unblockMock = unblock as jest.Mock
  const getBlocksMock = getBlocks as jest.Mock
  const firstAccount = createAccount('actor-1', 'alpha', 'Alpha')
  const secondAccount = createAccount('actor-2', 'beta', 'Beta')

  beforeEach(() => {
    unblockMock.mockReset()
    getBlocksMock.mockReset()
  })

  it('tracks pending unblock requests per account and clears loading on failure', async () => {
    let resolveUnblock: (value: null) => void = () => undefined
    unblockMock.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveUnblock = resolve
      })
    )

    render(
      <BlocksList accounts={[firstAccount, secondAccount]} nextMaxId={null} />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[0])
    await screen.findByText('Unblock account')
    const firstDialogButtons = screen.getAllByRole('button', {
      name: 'Unblock'
    })
    fireEvent.click(firstDialogButtons[firstDialogButtons.length - 1])

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'Unblock', hidden: true })[0]
      ).toBeDisabled()
    })
    expect(
      screen.getAllByRole('button', { name: 'Unblock', hidden: true })[1]
    ).toBeEnabled()

    await act(async () => {
      resolveUnblock(null)
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to unblock account. Please try again.'
    )
    const dialog = screen.getByRole('dialog', { name: 'Unblock account' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(
      within(dialog).getByRole('button', { name: 'Unblock' })
    ).toBeEnabled()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Unblock', hidden: true })[0]
    ).toBeEnabled()
  })

  it('removes only the successfully unblocked account', async () => {
    unblockMock.mockResolvedValueOnce({ blocking: false })

    render(
      <BlocksList accounts={[firstAccount, secondAccount]} nextMaxId={null} />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[1])
    await screen.findByText('Unblock account')
    const secondDialogButtons = screen.getAllByRole('button', {
      name: 'Unblock'
    })
    fireEvent.click(secondDialogButtons[secondDialogButtons.length - 1])

    await waitFor(() => {
      expect(unblockMock).toHaveBeenCalledWith({
        targetActorId: secondAccount.url
      })
    })
    await waitFor(() => {
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('dialog', { name: 'Unblock account' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('clears load-more loading state when fetching more blocks fails', async () => {
    let rejectGetBlocks: (error: Error) => void = () => undefined
    getBlocksMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectGetBlocks = reject
      })
    )

    render(<BlocksList accounts={[firstAccount]} nextMaxId="next-cursor" />)

    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(loadMoreButton)

    await waitFor(() => {
      expect(loadMoreButton).toBeDisabled()
    })

    await act(async () => {
      rejectGetBlocks(new Error('network failed'))
    })

    await waitFor(() => {
      expect(loadMoreButton).toBeEnabled()
    })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

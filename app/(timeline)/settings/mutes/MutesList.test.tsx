/**
 * @jest-environment jsdom
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

import { getMutes, unmute } from '@/lib/client'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { MutesList } from './MutesList'

jest.mock('@/lib/client', () => ({
  getMutes: jest.fn(),
  unmute: jest.fn()
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

describe('MutesList', () => {
  const unmuteMock = unmute as jest.Mock
  const getMutesMock = getMutes as jest.Mock
  const firstAccount = createAccount('actor-1', 'alpha', 'Alpha')
  const secondAccount = createAccount('actor-2', 'beta', 'Beta')

  beforeEach(() => {
    unmuteMock.mockReset()
    getMutesMock.mockReset()
  })

  it('shows the empty state when there are no muted accounts', () => {
    render(<MutesList accounts={[]} nextMaxId={null} />)
    expect(screen.getByText('No muted accounts.')).toBeInTheDocument()
  })

  it('removes only the successfully unmuted account', async () => {
    unmuteMock.mockResolvedValueOnce({ muting: false })

    render(
      <MutesList accounts={[firstAccount, secondAccount]} nextMaxId={null} />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Unmute' })[1])
    await screen.findByText('Unmute account')
    const dialogButtons = screen.getAllByRole('button', { name: 'Unmute' })
    fireEvent.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() => {
      expect(unmuteMock).toHaveBeenCalledWith({
        targetActorId: secondAccount.url
      })
    })
    await waitFor(() => {
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('dialog', { name: 'Unmute account' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('clears load-more loading state when fetching more mutes fails', async () => {
    let rejectGetMutes: (error: Error) => void = () => undefined
    getMutesMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectGetMutes = reject
      })
    )

    render(<MutesList accounts={[firstAccount]} nextMaxId="next-cursor" />)

    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(loadMoreButton)

    await waitFor(() => {
      expect(loadMoreButton).toBeDisabled()
    })

    await act(async () => {
      rejectGetMutes(new Error('network failed'))
    })

    await waitFor(() => {
      expect(loadMoreButton).toBeEnabled()
    })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('appends fetched accounts on Load more', async () => {
    const thirdAccount = createAccount('actor-3', 'gamma', 'Gamma')
    getMutesMock.mockResolvedValueOnce({
      accounts: [thirdAccount],
      nextMaxId: null,
      prevMinId: null
    })

    render(<MutesList accounts={[firstAccount]} nextMaxId="next-cursor" />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getMutesMock).toHaveBeenCalledWith({
        limit: 80,
        maxId: 'next-cursor'
      })
    })
    expect(await screen.findByText('Gamma')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('shows the error message when unmute returns a still-muting relationship', async () => {
    unmuteMock.mockResolvedValueOnce({ muting: true })

    render(<MutesList accounts={[firstAccount]} nextMaxId={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unmute account' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unmute' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to unmute account. Please try again.'
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
